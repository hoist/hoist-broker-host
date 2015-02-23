'use strict';
var BaseEvent = require('broker').events.ApplicationEvent;
var logger = require('hoist-logger');
var util = require('util');
var path = require('path');
var BBPromise = require('bluebird');
var _ = require('lodash');
var helpers = require('./helpers');
var sqsPublisher = require('./sqs_publisher');
var rabbitPublisher = require('./rabbit_publisher');


function ApplicationEvent(properties) {
  BaseEvent.call(this, properties);
  _.bindAll(this);
}

util.inherits(ApplicationEvent, BaseEvent);

ApplicationEvent.QueueName = 'application_event';

ApplicationEvent.prototype.process = function (callback) {

  //read event
  //build run module messages for executors
  logger.info('converting event to messages');
  this.convertToMessagesForExecutors()
    .bind(this)
    .then(function (messages) {
      //publish to rabbitmq (and sqs too for now)
      logger.info('sending messages to executors');
      return this.publishMessagesForExecutors(messages);
    }).then(function () {
      this.emit('done');
    }).nodeify(callback);

};

ApplicationEvent.prototype.convertToMessagesForExecutors = function () {
  return helpers.loadApplication(this.applicationId)
    .bind(this)
    .then(function (application) {
      if (!application) {
        throw new Error('application not found');
      }
      return helpers.getModulesToRunForEvent(application, this.eventName)
        .bind(this)
        .then(function (moduleNames) {
          return helpers.loadModuleDescriptions(application, moduleNames);
        }).then(function (moduleDescriptions) {
          var applicationPath = path.join(application.organisation.slug, application.slug, 'current');
          return _.map(moduleDescriptions, _.bind(function (moduleDescription) {
            return {
              applicationId: this.applicationId,
              correlationId: this.correlationId,
              moduleName: moduleDescription.name,
              modulePath: moduleDescription.src,
              environment: this.environment,
              eventId: this.eventId,
              event: this.eventId,
              bucketId: this.bucketId,
              applicationPath: applicationPath
            };
          }, this));
        });
    });
};
ApplicationEvent.prototype.publishMessagesForExecutors = function (messages) {
  return BBPromise.all([
    _.map(messages, function (message) {
      sqsPublisher.publish(message);
      rabbitPublisher.publish(message);
    })
  ]);
};
module.exports = ApplicationEvent;
