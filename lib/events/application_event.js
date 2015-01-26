'use strict';
var BaseEvent = require('broker').events.ApplicationEvent;
var config = require('config');
var logger = require('hoist-logger');
var util = require('util');
var BBPromise = require('bluebird');
var Model = require('hoist-model');
var Bucket = Model.Bucket;
var Session = Model.Session;
var AppUser = Model.AppUser;
var Organisation = Model.Organisation;
var Application = Model.Application;
var path = require('path');
var _ = require('lodash');
var AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: config.get('Hoist.aws.account'),
  secretAccessKey: config.get('Hoist.aws.secret'),
  region: config.get('Hoist.aws.region')
});

function ApplicationEvent(properties) {
  BaseEvent.call(this, properties);
  _.bindAll(this);

  this.sqs = BBPromise.promisifyAll(new AWS.SQS());
  this.ConcurrentMessages = 1;
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

ApplicationEvent.prototype.getQueueUrl = function () {
  return this.sqs.createQueueAsync({
    Attributes: {
      DelaySeconds: '0',
    },
    QueueName: config.get('Hoist.aws.prefix') + 'FAILED_EVENTS'
  }).bind(this).then(function (data) {
    return this.sqs.getQueueAttributesAsync({
      QueueUrl: data.QueueUrl,
      AttributeNames: ['QueueArn']
    });
  }).then(function (d) {
    this.deadLetterTargetArn = d.Attributes.QueueArn;
  }).then(function () {
    return this.sqs.createQueueAsync({
      Attributes: this.getDefaultQueueAttributes(),
      QueueName: config.get('Hoist.aws.prefix') + 'run_module_' + ApplicationEvent.QueueName + '-' + this.applicationId,
    });
  }).bind(this).then(function (data) {
    this.QueueUrl = data.QueueUrl;
  });

};
ApplicationEvent.prototype.getDefaultQueueAttributes = function () {
  return {
    DelaySeconds: '0',
    RedrivePolicy: JSON.stringify({
      maxReceiveCount: 1,
      deadLetterTargetArn: this.deadLetterTargetArn
    })
  };
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
  if (this.bucketId) {
    pipeline.push(Bucket.findOneAsync({
      _id: this.bucketId
    }).then(function (bucket) {
      context.bucket = bucket.toObject();
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
  if (!settings.on) {
    return null;
  }
  return settings.on[this.eventName];
};
ApplicationEvent.prototype.process = function (callback) {
  var log = new Model.ExecutionLogEvent({
    application: this.applicationId,
    environment: this.environment,
    eventId: this.eventId,
    type: 'EVT',
    correlationId: this.correlationId,
    moduleName: this.eventName,
    message: 'event ' + this.eventName + ' started processing'
  });
  log.saveAsync();
  return this.getQueueUrl()
    .then(function () {
      return Application.findOneAsync({
          _id: this.applicationId
        })
        .bind(this)
        .then(function (application) {
          return Organisation.findOneAsync({
            _id: application.organisation
          }).bind(this).then(function (org) {
            return this.messagePreparation(application, org);
          });
        });
    }).then(function (data) {
      var log = new Model.ExecutionLogEvent({
        application: this.applicationId,
        environment: this.environment,
        moduleName: this.eventName,
        eventId: this.eventId,
        correlationId: this.correlationId,
        type: 'EVT',
        message: 'event ' + this.eventName + ' processed'
      });
      log.saveAsync();
      clearInterval(this.pingInterval);
      this.emit('done');
      return data;
    }).nodeify(callback);
};

ApplicationEvent.prototype.messagePreparation = function (application, org) {
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

  this.pingInterval = setInterval(_.bind( /* istanbul ignore next */ function () {
    logger.debug('emitting ping');
    this.emit('ping');
  }, this), 30000);
  this.executionCount = modules.length;
  return BBPromise.all(_.map(modules, _.bind(function (moduleName) {
      return this.getModuleDescription(moduleName, application);
    }, this)))
    .bind(this)
    .then(function (moduleDescriptions) {
      var applicationDeployFolder = path.join(org.gitFolder, application.gitRepo, 'current');
      return BBPromise.all(_.map(moduleDescriptions, _.bind(function (moduleDescription) {
        return this.getContext(application)
          .bind(this)
          .then(function (context) {
            var log = new Model.ExecutionLogEvent({
              application: this.applicationId,
              environment: this.environment,
              eventId: this.eventId,
              type: 'MDL',
              correlationId: this.correlationId,
              moduleName: moduleDescription.name,
              message: 'module ' + moduleDescription.name + ' queued'
            });

            var jobData = {
              event: this.eventId,
              application: this.applicationId,
              applicationPath: applicationDeployFolder,
              modulePath: moduleDescription.src,
              moduleName: moduleDescription.name,
              module: moduleDescription,
              title: 'running module ' + moduleDescription.name
            };
            if (context.user) {
              jobData.user = context.user._id;
            }

            return this.sendMessage(jobData)
              .then(function (data) {
                log.message = log.message + 'SQS job #:' + data.MessageId;
                log.saveAsync();
                return data;
              });
          });
      }, this)));
    });
};

ApplicationEvent.prototype.sendMessage = function (jobData, delay) {
  delay = delay || 1000;
  return this.sqs.sendMessageAsync({
      MessageBody: JSON.stringify(jobData),
      QueueUrl: this.QueueUrl
    }).bind(this)
    .catch(function (err) {
      logger.info('err', err);
      logger.error(err, 'error sending run module event, pausing and retrying');
      delay = delay * 2;
      logger.info({
        delay: delay
      }, 'pausing before trying again');
      return BBPromise.delay(delay)
        .bind(this)
        .then(function () {
          return this.sendMessage(jobData, delay);
        });
    });
};
module.exports = ApplicationEvent;