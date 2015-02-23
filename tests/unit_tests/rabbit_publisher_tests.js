'use strict';
require('../bootstrap');
var amqp = require('amqplib');
var config = require('config');
var moment = require('moment');
var BBPromise = require('bluebird');
var expect = require('chai').expect;
var rabbitPublisher = require('../../lib/events/rabbit_publisher');
describe('RabbitPublisher', function () {
  var _connection;
  before(function () {
    return amqp.connect(config.get('Hoist.rabbit.url'))
      .then(function (connection) {
        _connection = connection;
      });
  });
  after(function () {
    return _connection.close();
  });
  describe('#publish', function () {

    var applicationId = 'applicationid_' + moment().format('x');
    before(function () {
      return rabbitPublisher.publish({
        applicationId: applicationId,
        data: 'foo'
      });
    });
    it('puts event on queue', function () {
      return _connection.createChannel()
        .then(function (channel) {
          return new BBPromise(function (resolve, reject) {
            //rather than erroring at the queue level this seems to error at the channel
            channel.on('error', reject);
            return channel.checkQueue('run_module_' + applicationId).then(function (result) {
              resolve(result);
            });
          });
        }).then(function (queueDetails) {
          expect(queueDetails.messageCount).to.eql(1);
        });
    });

    after(function () {
      return rabbitPublisher.close()
        .then(function () {
          return _connection.createChannel()
            .then(function (channel) {
              return channel.deleteQueue('run_module_' + applicationId).then(function () {
                return channel.close();
              });
            });
        });
    });
  });

  describe('#close', function () {

  });
});
