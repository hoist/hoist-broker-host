'use strict';
var amqp = require('amqplib');
var config = require('config');
var BBPromise = require('bluebird');
var _ = require('lodash');
var logger = require('hoist-logger');

function RabbitPublisher() {
  _.bindAll(this);


}
RabbitPublisher.prototype.getConnection = function () {
  return this.connection || (this.connection = BBPromise.resolve(amqp.connect(config.get('Hoist.rabbit.url'))).then(function (connection) {
    connection.on('error', function (err) {
      console.log('got an error in the connection', err);
    });
    return connection;
  }));
};
RabbitPublisher.prototype.publish = function (message) {
  logger.info('getting rabbitmq queue');
  return this.getQueue(message)
    .bind(this)
    .then(function (queue) {
      logger.info('sending message to rabbitmq');
      return this.sendMessage(queue, message);
    });
};
RabbitPublisher.prototype.getQueue = function (message) {
  return this.getConnection()
    .bind(this)
    .then(function (connection) {
      return connection.createChannel();
    }).then(function (channel) {
      return channel.assertQueue('run_module_' + message.applicationId, {
        durable: true
      });
    });
};
RabbitPublisher.prototype.sendMessage = function (queue, message) {
  return this.getConnection()
    .bind(this)
    .then(function (connection) {
      return connection.createChannel();
    }).then(function sendMessageToChannel(channel) {
      var content = new Buffer(JSON.stringify(message));
      return channel.sendToQueue(queue.queue, content, {
        persitent: true,
        appId: 'event-broker',
        type: 'module-run-message'
      });
    });
};

RabbitPublisher.prototype.close = function () {
  if (this.connection) {
    return this.getConnection().bind(this).then(function (connection) {
      delete this.connection;
      return connection.close();

    });
  } else {
    return BBPromise.resolve({});
  }
};

module.exports = new RabbitPublisher();
