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
  context.event = this.toJSON();
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
ApplicationEvent.prototype.process = function (callback) {
  var log = new Model.ExecutionLogEvent({
    application: this.applicationId,
    environment: this.environment,
    eventId: this.eventId,
    correlationId: this.correlationId,
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
                    eventId: this.eventId,
                    type:'MDL',
                    correlationId: this.correlationId,
                    moduleName: moduleDescription.name,
                    message: 'module ' + moduleDescription.name + ' queued'
                  });

                  var jobData = {
                    application: context.application,
                    user: context.user,
                    environment: context.environment,
                    event: this.toJSON(),
                    correlationId: this.correlationId,
                    eventId: this.eventId,
                    applicationPath: applicationDeployFolder,
                    modulePath: moduleDescription.src,
                    moduleName: moduleDescription.name,
                    module: moduleDescription,
                    title: 'running module ' + moduleDescription.name
                  };
                  var job = kueProxy.get().create('RunModule', jobData);
                  return BBPromise.promisify(job.save, job)().then(function () {
                    log.message = log.message + ' job #:' + job.id;
                    return log.saveAsync();
                  });
                });
            }, this)));

          });

      });
    }).then(function () {
      var log = new Model.ExecutionLogEvent({
        application: this.applicationId,
        environment: this.environment,
        moduleName: this.eventName,
        eventId: this.eventId,
        correlationId: this.correlationId,
        type:'EVT',
        message: 'event ' + this.eventName + ' processed'
      });
      log.saveAsync();
      clearInterval(this.pingInterval);
      this.emit('done');
    }).nodeify(callback);
};
module.exports = ApplicationEvent;
