'use strict';
require('../bootstrap');
var config = require('config');
var Model = require('hoist-model');
var BBPromise = require('bluebird');
var mongoose = BBPromise.promisifyAll(Model._mongoose);
var expect = require('chai').expect;
var ApplicationEvent = require('../../lib/events/application_event');
var sinon = require('sinon');
var path = require('path');

describe('application_event', function () {
  describe('with event description', function () {
    describe('with modules in event description', function () {
      describe('with no error in sending message', function () {
        var _response;
        var applicationEvent;
        var jobData;
        var _appUser;
        before(function () {
          return BBPromise.all([
            mongoose.connectAsync(config.get('Hoist.mongo.db')),
            new Model.Organisation({
              _id: 'orgid',
              name: 'test org',
              slug: 'org'
            }).saveAsync(),
            new Model.Application({
              _id: 'appid',
              organisation: 'orgid',
              name: 'test app',
              apiKey: 'apiKey',
              slug: 'app',
              settings: {
                test: {
                  on: {
                    eventName: {
                      modules: ['module']
                    }
                  },
                  modules: [{
                    name: 'module',
                    src: '../../file.js'
                  }]
                }
              }
            }).saveAsync(),
            new Model.AppUser({
              _id: 'appUserId',
              application: 'appId',
              emailAddresses: [{
                address: 'test@test.com'
              }],
              environment: 'test',
            }).saveAsync().then(function (user) {
              _appUser = user[0];
            }),
            new Model.Bucket({
              _id: 'bucketId',
              application: 'appId',
              environment: 'test'
            }).saveAsync(),
            new Model.Session({
              _id: 'sessionId',
              appUser: 'appUserId',
              application: 'appId',
              environment: 'test'
            }).saveAsync()
          ]).then(function () {
            jobData = {
              user: _appUser.toObject(),
              event: {
                eventId: 'eventId',
                messageId: 'eventId',
                correlationId: 'correlationId',
                applicationId: 'appid',
                eventName: 'eventName',
                environment: 'test',
                bucketId: 'bucketId',
                sessionId: 'sessionId'
              },
              applicationPath: path.join('org', 'app', 'current'),
              modulePath: '../../file.js',
              moduleName: 'module',
              module: {
                src: '../../file.js',
                name: 'module'
              },
              title: 'running module module'
            };
            var properties = {
              applicationId: 'appid',
              eventName: 'eventName',
              environment: 'test',
              eventId: 'eventId',
              correlationId: 'correlationId',
              bucketId: 'bucketId',
              sessionId: 'sessionId'
            };
            applicationEvent = new ApplicationEvent(properties);
            sinon.spy(applicationEvent.sqs, 'sendMessageAsync');
            return applicationEvent.process().then(function (response) {
              _response = response;
            });
          });
        });
        after(function () {
          return BBPromise.all([
            Model.AppUser.removeAsync({}),
            Model.Organisation.removeAsync({}),
            Model.Application.removeAsync({}),
            Model.Session.removeAsync({}),
            Model.Bucket.removeAsync({}),
            Model.ExecutionLogEvent.removeAsync({})
          ]).then(function () {
            applicationEvent.sqs.sendMessageAsync.restore();
            return mongoose.disconnectAsync();
          });
        });
        it('sends the correct data to AWS', function () {
          jobData.user.createdAt = jobData.user.createdAt.toISOString();
          jobData.user.updatedAt = jobData.user.updatedAt.toISOString();
          var messageBody = applicationEvent.sqs.sendMessageAsync.args[0][0].MessageBody;
          expect(JSON.parse(messageBody))
            .to.be.eql(jobData);
        });
        it('returns the data from AWS', function () {
          expect(_response[0]).to.have.property('ResponseMetadata');
        });
      });
      describe('with error in sending message ', function () {
        this.timeout(5000);
        var _response;
        var applicationEvent;
        var jobData;
        var _appUser;
        before(function () {
          return BBPromise.all([
            mongoose.connectAsync(config.get('Hoist.mongo.db')),
            new Model.Organisation({
              _id: 'orgid',
              name: 'test org',
              slug: 'org'
            }).saveAsync(),
            new Model.Application({
              _id: 'appid',
              organisation: 'orgid',
              name: 'test app',
              apiKey: 'apiKey',
              slug: 'app',
              settings: {
                test: {
                  on: {
                    eventName: {
                      modules: ['module']
                    }
                  },
                  modules: [{
                    name: 'module',
                    src: '../../file.js'
                  }]
                }
              }
            }).saveAsync(),
            new Model.AppUser({
              _id: 'appUserId',
              application: 'appId',
              emailAddresses: [{
                address: 'test@test.com'
              }],
              environment: 'test',
            }).saveAsync().then(function (user) {
              _appUser = user[0];
            }),
            new Model.Bucket({
              _id: 'bucketId',
              application: 'appId',
              environment: 'test'
            }).saveAsync(),
            new Model.Session({
              _id: 'sessionId',
              appUser: 'appUserId',
              application: 'appId',
              environment: 'test'
            }).saveAsync()
          ]).then(function () {
            jobData = {
              user: _appUser.toObject(),
              event: {
                eventId: 'eventId',
                messageId: 'eventId',
                correlationId: 'correlationId',
                applicationId: 'appid',
                eventName: 'eventName',
                environment: 'test',
                bucketId: 'bucketId',
                sessionId: 'sessionId'
              },
              applicationPath: path.join('org', 'app', 'current'),
              modulePath: '../../file.js',
              moduleName: 'module',
              module: {
                src: '../../file.js',
                name: 'module'
              },
              title: 'running module module'
            };
            jobData.user.createdAt = jobData.user.createdAt.toISOString();
            jobData.user.updatedAt = jobData.user.updatedAt.toISOString();
            var properties = {
              applicationId: 'appid',
              eventName: 'eventName',
              environment: 'test',
              eventId: 'eventId',
              correlationId: 'correlationId',
              bucketId: 'bucketId',
              sessionId: 'sessionId'
            };
            applicationEvent = new ApplicationEvent(properties);
            sinon.stub(applicationEvent.sqs, 'sendMessageAsync')
            .onFirstCall().returns(BBPromise.reject('sendMessageAsync failed'))
            .onSecondCall().returns(BBPromise.resolve({MessageBody: 'messageBody'}));
            return applicationEvent.process().then(function (response) {
              _response = response;
            });
          });
        });
        after(function () {
          return BBPromise.all([
            Model.AppUser.removeAsync({}),
            Model.Organisation.removeAsync({}),
            Model.Application.removeAsync({}),
            Model.Session.removeAsync({}),
            Model.Bucket.removeAsync({}),
            Model.ExecutionLogEvent.removeAsync({})
          ]).then(function () {
            applicationEvent.sqs.sendMessageAsync.restore();
            return mongoose.disconnectAsync();
          });
        });
        it('sends the correct data to AWS on first call', function () {
          var messageBody = applicationEvent.sqs.sendMessageAsync.args[0][0].MessageBody;
          expect(JSON.parse(messageBody))
            .to.be.eql(jobData);
        });
        it('sends the correct data to AWS on second call', function () {
          var messageBody = applicationEvent.sqs.sendMessageAsync.args[1][0].MessageBody;
          expect(JSON.parse(messageBody))
            .to.be.eql(jobData);
        });
        it('calls sendMessage twice', function () {
          expect(applicationEvent.sqs.sendMessageAsync.calledTwice).to.be.true();
        });
      });
    });
    describe('without modules in event description', function () {
      var _response;
      var applicationEvent;
      var jobData;
      var _appUser;
      before(function () {

        return BBPromise.all([
          mongoose.connectAsync(config.get('Hoist.mongo.db')),
          new Model.Organisation({
            _id: 'orgid',
            name: 'test org',
            slug: 'org'
          }).saveAsync(),
          new Model.Application({
            _id: 'appid',
            organisation: 'orgid',
            name: 'test app',
            apiKey: 'apiKey',
            slug: 'app',
            settings: {
              test: {
                on: {
                  eventName: {
                    modules: []
                  }
                },
                modules: [{
                  name: 'module',
                  src: '../../file.js'
                }]
              }
            }
          }).saveAsync(),
          new Model.AppUser({
            _id: 'appUserId',
            application: 'appId',
            emailAddresses: [{
              address: 'test@test.com'
            }],
            environment: 'test',
          }).saveAsync().then(function (user) {
            _appUser = user[0];
          }),
          new Model.Bucket({
            _id: 'bucketId',
            application: 'appId',
            environment: 'test'
          }).saveAsync(),
          new Model.Session({
            _id: 'sessionId',
            appUser: 'appUserId',
            application: 'appId',
            environment: 'test'
          }).saveAsync()
        ]).then(function () {
          jobData = {
            user: _appUser.toObject(),
            event: {
              eventId: 'eventId',
              messageId: 'eventId',
              correlationId: 'correlationId',
              applicationId: 'appid',
              eventName: 'eventName',
              environment: 'test',
              bucketId: 'bucketId',
              sessionId: 'sessionId'
            },
            applicationPath: path.join('org', 'app', 'current'),
            modulePath: '../../file.js',
            moduleName: 'module',
            module: {
              src: '../../file.js',
              name: 'module'
            },
            title: 'running module module'
          };
          var properties = {
            applicationId: 'appid',
            eventName: 'eventName',
            environment: 'test',
            eventId: 'eventId',
            correlationId: 'correlationId',
            bucketId: 'bucketId',
            sessionId: 'sessionId'
          };
          applicationEvent = new ApplicationEvent(properties);
          sinon.spy(applicationEvent.sqs, 'sendMessageAsync');
          return applicationEvent.process().then(function (response) {
            _response = response;
          });
        });
      });
      after(function () {
        return BBPromise.all([
          Model.AppUser.removeAsync({}),
          Model.Organisation.removeAsync({}),
          Model.Application.removeAsync({}),
          Model.Session.removeAsync({}),
          Model.Bucket.removeAsync({}),
          Model.ExecutionLogEvent.removeAsync({})
        ]).then(function () {
          applicationEvent.sqs.sendMessageAsync.restore();
          return mongoose.disconnectAsync();
        });
      });
      it('does not send to AWS', function () {
        expect(applicationEvent.sqs.sendMessageAsync.called)
          .to.be.false();
      });
      it('returns the data from AWS', function () {
        expect(_response).to.not.exist();
      });
    });
  });

  describe('without event description', function () {
    var _response;
    var applicationEvent;
    var jobData;
    var _appUser;
    before(function () {

      return BBPromise.all([
        mongoose.connectAsync(config.get('Hoist.mongo.db')),
        new Model.Organisation({
          _id: 'orgid',
          name: 'test org',
          slug: 'org'
        }).saveAsync(),
        new Model.Application({
          _id: 'appid',
          organisation: 'orgid',
          name: 'test app',
          apiKey: 'apiKey',
          slug: 'app',
          settings: {
            test: {
              on: {},
              modules: [{
                name: 'module',
                src: '../../file.js'
              }]
            }
          }
        }).saveAsync(),
        new Model.AppUser({
          _id: 'appUserId',
          application: 'appId',
          emailAddresses: [{
            address: 'test@test.com'
          }],
          environment: 'test',
        }).saveAsync().then(function (user) {
          _appUser = user[0];
        }),
        new Model.Bucket({
          _id: 'bucketId',
          application: 'appId',
          environment: 'test'
        }).saveAsync(),
        new Model.Session({
          _id: 'sessionId',
          appUser: 'appUserId',
          application: 'appId',
          environment: 'test'
        }).saveAsync()
      ]).then(function () {
        jobData = {
          user: _appUser.toObject(),
          event: {
            eventId: 'eventId',
            messageId: 'eventId',
            correlationId: 'correlationId',
            applicationId: 'appid',
            eventName: 'eventName',
            environment: 'test',
            bucketId: 'bucketId',
            sessionId: 'sessionId'
          },
          applicationPath: path.join('org', 'app', 'current'),
          modulePath: '../../file.js',
          moduleName: 'module',
          module: {
            src: '../../file.js',
            name: 'module'
          },
          title: 'running module module'
        };
        var properties = {
          applicationId: 'appid',
          eventName: 'eventName',
          environment: 'test',
          eventId: 'eventId',
          correlationId: 'correlationId',
          bucketId: 'bucketId',
          sessionId: 'sessionId'
        };
        applicationEvent = new ApplicationEvent(properties);
        sinon.spy(applicationEvent.sqs, 'sendMessageAsync');
        return applicationEvent.process().then(function (response) {
          _response = response;
        });
      });
    });
    after(function () {
      return BBPromise.all([
        Model.AppUser.removeAsync({}),
        Model.Organisation.removeAsync({}),
        Model.Application.removeAsync({}),
        Model.Session.removeAsync({}),
        Model.Bucket.removeAsync({}),
        Model.ExecutionLogEvent.removeAsync({})
      ]).then(function () {
        applicationEvent.sqs.sendMessageAsync.restore();
        return mongoose.disconnectAsync();
      });
    });
    it('does not send to AWS', function () {
      expect(applicationEvent.sqs.sendMessageAsync.called)
        .to.be.false();
    });
    it('returns the data from AWS', function () {
      expect(_response).to.not.exist();
    });
  });


});