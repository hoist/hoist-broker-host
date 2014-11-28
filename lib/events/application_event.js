'use strict';
var BaseEvent = require('broker').events.ApplicationEvent;
var logger = require('hoist-logger');
var util = require('util');
var BBPromise = require('bluebird');
var Model = require('hoist-model');
var Session = Model.Session;
var AppUser = Model.AppUser;
var Organisation = Model.Organisation;
var Application = Model.Application;
var path = require('path');
var _ = require('lodash');
var kueProxy = require('../kue_proxy');
var moment = require('moment');

function ApplicationEvent(properties) {
  BaseEvent.call(this, properties);
  _.bindAll(this);
}

util.inherits(ApplicationEvent, BaseEvent);

ApplicationEvent.QueueName = 'application_event';
ApplicationEvent.prototype.getModuleDescription = function (moduleName, application) {
  return BBPromise.try(function () {
    var module = null;
    var settings = application.settings[this.environment];
    if (settings) {
      module = _.find(settings.modules, function (moduleDesc) {
        return moduleDesc.name === moduleName;
      });
    }
    return module;
  }, [], this);
};
ApplicationEvent.prototype.getContext = function (application) {
  var context = {};
  var pipeline = [];
  context.applicationId = this.applicationId;
  context.environment = this.environment;
  if (this.sessionId) {
    pipeline.push(Session.findOneAsync({
        _id: this.sessionId
      })
      .then(function (session) {
        if (session) {
          context.sessionId = session._id;
          if (session.appUser) {
            return AppUser.findOneAsync({
              _id: session.appUser
            }).then(function (appUser) {
              if (appUser) {
                context.user = appUser.toObject();
              }
            });
          }
        }
      }));
  }

  context.application = application.toObject();

  return BBPromise.all(pipeline).then(function () {
    return context;
  });
};
ApplicationEvent.prototype.getEventDescription = function (application) {
  var environment = this.environment || 'live';
  var settings = application.settings[environment];
  return settings.on[this.eventName];
};
ApplicationEvent.prototype.registerJobComplete = function (id) {
  if (this.timeouts[id]) {
    this.decrementJob(id);
    require('kue').Job.get(id, function (err, job) {
      if (err) {
        return;
      }
      job.remove(function (err) {
        if (err) {
          throw err;
        }
        logger.info(util.format('removed completed job #%d', job.id));
      });
    });
  }
};
ApplicationEvent.prototype.registerJobFailed = function (id) {
  console.log('job failed', arguments);
  if (this.timeouts[id]) {
    this.decrementJob(id);
    require('kue').Job.log(id, function (err, logs) {
      console.log(logs);
    });
  }
};
ApplicationEvent.prototype.decrementJob = function (id) {
  clearTimeout(this.timeouts[id]);
  this.executionCount--;
  if (this.executionCount < 1) {
    clearInterval(this.pingInterval);
    kueProxy.get().removeListener('job failed', this.registerJobFailed);
    kueProxy.get().removeListener('job complete', this.registerJobComplete);
    this.emit('done');
  }
};
ApplicationEvent.prototype.process = function (callback) {
  var log = new Model.ExecutionLogEvent({
    application: this.applicationId,
    environment: this.environment,
    moduleName: this.eventName,
    message: 'event ' + this.eventName + ' started processing'
  });
  log.saveAsync();
  return Application.findOneAsync({
      _id: this.applicationId
    })
    .bind(this)
    .then(function (application) {
      return Organisation.findOneAsync({
        _id: application.organisation
      }).bind(this).then(function (org) {
        var eventDescription = this.getEventDescription(application);
        if (!eventDescription) {
          this.emit('done');
          return;
        }
        var modules = eventDescription.modules;
        if (!modules || modules.length < 1) {
          this.emit('done');
          return;
        }
        this.timeouts = {};
        this.pingInterval = setInterval(_.bind(function () {
          logger.debug('emitting ping');
          this.emit('ping');
        }, this), 30000);
        this.executionCount = modules.length;
        kueProxy.get().on('job failed', this.registerJobFailed);
        kueProxy.get().on('job complete', this.registerJobComplete);
        return BBPromise.all(_.map(modules, _.bind(function (moduleName) {
            return this.getModuleDescription(moduleName, application);
          }, this)))
          .bind(this)
          .then(function (moduleDescriptions) {
            var lastDeployTimestamp = moment(application.lastDeploy[this.environment]);
            var applicationDeployFolder = path.join(org.gitFolder, application.gitRepo, lastDeployTimestamp.format('X'));
            return BBPromise.all(_.map(moduleDescriptions, _.bind(function (moduleDescription) {
              return this.getContext(application)
                .bind(this)
                .then(function (context) {
                  var log = new Model.ExecutionLogEvent({
                    application: this.applicationId,
                    environment: this.environment,
                    moduleName: moduleDescription.name,
                    message: 'module ' + moduleDescription.name + ' queued'
                  });
                  log.saveAsync();
                  var jobData = {
                    application: context.application,
                    user: context.user,
                    environment: context.environment,
                    event: this.toJSON(),
                    applicationPath: applicationDeployFolder,
                    modulePath: moduleDescription.src,
                    moduleName: moduleDescription.name,
                    module: moduleDescription,
                    title: 'running module ' + moduleDescription.name
                  };
                  var job = kueProxy.get().create('RunModule', jobData)
                    .save(_.bind(function (err) {
                      if (err) {
                        logger.alert(err);
                        logger.error(err, 'unable to save execution job');
                      }
                      //execution should be done in two mins
                      this.timeouts[job.id] = setTimeout(_.bind(function () {
                        var delayedError = new Error('RunModule job seems to be stuck on queue');
                        logger.alert(delayedError, this.applicationId, {
                          jobId: job.id,
                          event: this.toJSON()
                        });
                        logger.error(delayedError);
                      }, this), 120000);
                    }, this));

                });
            }, this))).then(function () {
              var log = new Model.ExecutionLogEvent({
                application: this.applicationId,
                environment: this.environment,
                moduleName: this.eventName,
                message: 'event ' + this.eventName + ' processed'
              });
              log.saveAsync();
            });
          });

      });
    }).nodeify(callback);
};
module.exports = ApplicationEvent;
