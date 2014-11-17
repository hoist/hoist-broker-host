'use strict';
var EventBroker = require('broker/lib/event_broker');
var mongoose = require('hoist-model')._mongoose;
var config = require('config');
var logger = require('hoist-logger');

mongoose.set('debug',true);
mongoose.connect(config.get('Hoist.mongo.db'), function subscribeToEvents(err) {
  /* istanbul ignore if */
  if(err){
    logger.error(err);
  }

  EventBroker.model = require('hoist-model');
  EventBroker.subscribe(require('broker/lib/event_types/application_event'), function () {
    logger.info('listening');
  });
});
