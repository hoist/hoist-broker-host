'use strict';
var AWS = require('aws-sdk');
var config = require('config');
var _ = require('lodash');
var BBPromise = require('bluebird');
var logger = require('hoist-logger');
AWS.config.update({
  accessKeyId: config.get('Hoist.aws.account'),
  secretAccessKey: config.get('Hoist.aws.secret'),
  region: config.get('Hoist.aws.region')
});

function SQSPublisher() {

  _.bindAll(this);
  this.sqs = BBPromise.promisifyAll(new AWS.SQS());
  //lets make this call only once
  this.getDefaultQueueAttributes = this.sqs.createQueueAsync({
      Attributes: {
        DelaySeconds: '0',
      },
      QueueName: config.get('Hoist.aws.prefix') + 'FAILED_EVENTS'
    })
    .bind(this)
    .then(function (data) {
      return this.sqs.getQueueAttributesAsync({
        QueueUrl: data.QueueUrl,
        AttributeNames: ['QueueArn']
      });
    }).then(function (data) {
      return {
        DelaySeconds: '0',
        VisibilityTimeout: '600',
        RedrivePolicy: JSON.stringify({
          maxReceiveCount: 1,
          deadLetterTargetArn: data.Attributes.QueueArn
        })
      };
    }).catch(function (err) {
      logger.error(err, 'error setting up sqs');
    });
}

SQSPublisher.prototype.publish = function (message) {
  logger.info('getting sqs queue details');
  return this.getQueue(message)
    .bind(this)
    .then(function (queue) {
      logger.info('sending message to sqs');
      return this.sendMessage(queue, message);
    });
};
SQSPublisher.prototype.sendMessage = function (queueUrl, message) {
  return this.sqs.sendMessageAsync({
      MessageBody: JSON.stringify(message),
      QueueUrl: queueUrl
    }).bind(this)
    .catch(function (err) {
      logger.info('err', err);
      logger.error(err, 'error sending run module event, pausing and retrying');
      return BBPromise.delay(2000)
        .bind(this)
        .then(function () {
          return this.sendMessage(queueUrl, message);
        });
    });
};

SQSPublisher.prototype.getQueue = function (message) {
  //create dead letter queue
  return this.getDefaultQueueAttributes
    .bind(this)
    .then(function (attributes) {
      return this.sqs.createQueueAsync({
        Attributes: attributes,
        QueueName: config.get('Hoist.aws.prefix') + 'run_module_application_event-' + message.applicationId,
      });
    }).then(function (data) {
      return data.QueueUrl;
    });
};


module.exports = new SQSPublisher();
