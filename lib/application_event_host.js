'use strict';
var EventBroker = require('broker/lib/event_broker');
var mongoose = require('hoist-model')._mongoose;
var config = require('config');

mongoose.connect(config.mongo.db, function () {
  EventBroker.subscribe(require('broker/lib/event_types/application_event'), function () {
    console.log('listening');
  });
});
