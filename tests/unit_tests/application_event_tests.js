'use strict';
require('../bootstrap');
var ApplicationEvent = require('../../lib/events/application_event');
var sinon = require('sinon');
var BBPromise = require('bluebird');
var expect = require('chai').expect;
var config = require('config');
var Model = require('hoist-model');
var mongoose = BBPromise.promisifyAll(Model._mongoose);

describe('ApplicationEvent', function () {
  var applicationEvent = new ApplicationEvent({
    bucketId: 'bucketId',
    eventId: 'eventId',
    applicationId: 'applicationId',
    environment: 'live',
    eventName: 'event',
    correlationId: 'cid'
  });
  before(function () {
    return mongoose.connectAsync(config.get('Hoist.mongo.db'))
      .then(function () {
        return BBPromise.all([
          new Model.Organisation({
            _id: 'org',
            slug: 'org',
            name: 'test org'
          }).saveAsync(),
          new Model.Application({
            _id: 'applicationId',
            organisation: 'org',
            name: 'test app',
            slug: 'app',
            settings: {
              live: {
                modules: [{
                  name: 'module1',
                  src: './module1.js'
                }, {
                  name: 'module2',
                  src: './module2.js'
                }],
                on: {
                  'event': {
                    modules: ['module1', 'module2']
                  }
                }
              }
            }
          }).saveAsync()
        ]);
      });
  });
  after(function () {
    return BBPromise.all([
      Model.Organisation.removeAsync({}),
      Model.Application.removeAsync({})
    ]).then(function () {
      return mongoose.disconnectAsync();
    });
  });

  describe('#process', function () {
    var messages = [1, 2];
    before(function (done) {
      sinon.stub(applicationEvent, 'convertToMessagesForExecutors').returns(BBPromise.resolve(messages));
      sinon.stub(applicationEvent, 'publishMessagesForExecutors').returns(BBPromise.resolve(null));
      applicationEvent.process(done);
    });
    it('converts event to messages for executors', function () {
      return expect(applicationEvent.convertToMessagesForExecutors)
        .to.have.been.called;
    });
    it('sends messages to executors', function () {
      return expect(applicationEvent.publishMessagesForExecutors)
        .to.have.been.calledWith(messages);
    });
    after(function () {
      applicationEvent.convertToMessagesForExecutors.restore();
      applicationEvent.publishMessagesForExecutors.restore();
    });
  });
  describe('#convertToMessagesForExecutors', function () {
    var messages;
    before(function () {
      return applicationEvent.convertToMessagesForExecutors()
        .then(function (result) {
          messages = result;
        });
    });
    it('creates a message for each module to run', function () {
      expect(messages.length).to.eql(2);
    });
    it('sets correct #applicationId on messages', function () {
      expect(messages[0].applicationId).to.eql('applicationId');
      expect(messages[1].applicationId).to.eql('applicationId');
    });
    it('sets correct #correlationId on messages', function () {
      expect(messages[0].correlationId).to.eql('cid');
      expect(messages[1].correlationId).to.eql('cid');
    });
    it('sets correct #moduleName on messages', function () {
      var moduleNames = [messages[0].moduleName, messages[1].moduleName];
      expect(moduleNames).to.contain('module1');
      expect(moduleNames).to.contain('module2');
    });
    it('sets correct #module path on messages', function () {
      var modulePaths = [messages[0].modulePath, messages[1].modulePath];
      expect(modulePaths).to.contain('./module1.js');
      expect(modulePaths).to.contain('./module2.js');
    });
    it('sets correct #environment on messages', function () {
      expect(messages[0].environment).to.eql('live');
      expect(messages[1].environment).to.eql('live');
    });
    it('sets correct #eventId on messages', function () {
      expect(messages[0].eventId).to.eql('eventId');
      expect(messages[1].eventId).to.eql('eventId');
    });
    it('sets correct #bucketId on messages', function () {
      expect(messages[0].bucketId).to.eql('bucketId');
      expect(messages[1].bucketId).to.eql('bucketId');
    });
    it('sets correct #event on messages (for backwards compatability)', function () {
      expect(messages[0].event).to.eql('eventId');
      expect(messages[1].event).to.eql('eventId');
    });
    it('sets correct #applicationPath on messages (for backwards compatibility)', function () {
      expect(messages[0].applicationPath).to.eql('org/app/current');
      expect(messages[1].applicationPath).to.eql('org/app/current');
    });
  });
  describe('#publishMessagesForExecutors', function () {
    var rabbitPublisher = require('../../lib/events/rabbit_publisher');
    var sqsPublisher = require('../../lib/events/sqs_publisher');
    var messages = [{
      data: 1
    }, {
      data: 2
    }];
    before(function () {
      sinon.stub(rabbitPublisher,'publish').returns(BBPromise.resolve(null));
      sinon.stub(sqsPublisher,'publish').returns(BBPromise.resolve(null));
      return applicationEvent.publishMessagesForExecutors(messages);
    });
    after(function () {
      rabbitPublisher.publish.restore();
      sqsPublisher.publish.restore();
    });
    it('publishes each message to rabbitmq', function () {
      expect(rabbitPublisher.publish)
        .to.have.been.calledWith(messages[0]);
      expect(rabbitPublisher.publish)
        .to.have.been.calledWith(messages[1]);
    });
    it('publishes a message to sqs (for backwards compatability)', function () {
      expect(sqsPublisher.publish)
        .to.have.been.calledWith(messages[0]);
      expect(sqsPublisher.publish)
        .to.have.been.calledWith(messages[1]);
    });
  });
});
