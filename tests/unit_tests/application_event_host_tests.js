'use strict';
require('../bootstrap');
var sinon = require('sinon');
var mongoose = require('hoist-model')._mongoose;
var EventBroker = require('broker/lib/event_broker');
var expect = require('chai').expect;
describe('application_event_host', function () {
  before(function () {
    sinon.stub(mongoose, 'connect').callsArg(1);
    sinon.stub(EventBroker, 'subscribe').callsArg(1);
    require('../../lib/application_event_host');
  });
  it('subscribes to ApplicationEvents', function () {
    expect(EventBroker.subscribe)
      .to.be.calledWith(require('broker/lib/event_types/application_event'));
  });
  it('opens mongo connection', function () {
    expect(mongoose.connect)
      .to.be.calledWith('mongodb://localhost/hoist-test');
  });
});
