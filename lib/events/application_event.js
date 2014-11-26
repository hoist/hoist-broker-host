'use strict';
var BaseEvent = require('broker').events.ApplicationEvent;
var logger = require('hoist-logger');
var util = require('util');
var BBPromise = require('BBPromise');
var Model = require('hoist-model');
var Session = Model.Session;
var AppUser = Model.AppUser;
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
  });
};
ApplicationEvent.prototype.raiseExecuteJob = function (moduleName, application) {
  var lastDeployTimestamp = moment(application.lastDeploy[this.environment]);
  var applicationDeployFolder = path.join(application.organisation.gitFolder, application.gitRepo, lastDeployTimestamp.format('X'));

  return this.getModuleDescription(moduleName, application)
    .bind(this)
    .then(function () {
      this.getContext(application).then(function (context) {
        return new BBPromise(function (resolve) {
          var jobData = {
            context: context,
            applicationDeployFolder: applicationDeployFolder,
            module: module,
            title: 'running module ' + module.name
          };
          var job = kueProxy.get().create('module_run', jobData);
          job.on('failed', _.bind(function () {

          }, this));
          job.on('complete', _.bind(function () {
            resolve();
          }, this));
        });
      });
    });
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
  if (this.timeouts[id]) {
    this.decrementJob(id);
  }
};
ApplicationEvent.prototype.decrementJob = function (id) {
  clearTimeout(this.timeouts[id]);
  this.executionCount--;
  if (this.executionCount < 1) {
    kueProxy.get().removeListener('job failed', this.registerJobFailed);
    kueProxy.get().removeListener('job complete', this.registerJobComplete);
    this.done();
  }
};
ApplicationEvent.prototype.process = function (callback) {
  return Application.findOne({
      _id: this.applicationId
    })
    .bind(this)
    .then(function (application) {
      this.getEventDescription(application)
        .then(function (eventDescription) {
          return eventDescription.modules;
        }).then(function (modules) {
          if (!modules || modules.length < 1) {
            this.emit('done');
            return;
          }
          this.timeouts = {};
          this.executionCount = modules.length;
          kueProxy.get().on('job failed', this.registerJobFailed);
          kueProxy.get().on('job complete', this.registerJobComplete);
          return BBPromise.all(_.map(modules, _.bind(function (moduleName) {
              return this.getModuleDescription(moduleName, application);
            }, this)))
            .bind(this)
            .then(function (moduleDescriptions) {
              var lastDeployTimestamp = moment(application.lastDeploy[this.environment]);
              var applicationDeployFolder = path.join(application.organisation.gitFolder, application.gitRepo, lastDeployTimestamp.format('X'));
              return BBPromise.all(_.map(moduleDescriptions, _.bind(function (moduleDescription) {
                return this.getContext(application)
                  .bind(this)
                  .then(function (context) {
                    var jobData = {
                      context: context,
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
                        this.timeouts[job.id] = setTimeout(function () {
                          logger.alert(new Error('RunModule job id ' + job.id + ' seems to be stuck on queue'));
                        }, 120000);
                      }, this));

                  });
              }, this)));
            });

        });
    }).nodeify(callback);
};
