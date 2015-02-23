'use strict';
require('../bootstrap');
var sinon = require('sinon');
var mongoose = require('hoist-model')._mongoose;
var EventBroker = require('broker');
var expect = require('chai').expect;
describe('application_event_host', function () {
  before(function () {
    sinon.stub(mongoose, 'connect').callsArg(1);
    sinon.stub(EventBroker.prototype, 'listen').callsArg(1);
    require('../../lib/application_event_host');
  });
  after(function () {
    mongoose.connect.restore();
    EventBroker.prototype.listen.restore();
  });
  it('subscribes to ApplicationEvents', function () {
    expect(EventBroker.prototype.listen)
      .to.be.calledWith(require('../../lib/events/application_event'));
  });
  it('sets model for broker', function () {
    expect(EventBroker.ModelResolver.get())
      .to.eql(require('hoist-model'));
  });
  it('opens mongo connection', function () {
    expect(mongoose.connect)
      .to.be.calledWith('mongodb://localhost/hoist-test');
  });
});
