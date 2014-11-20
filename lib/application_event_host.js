'use strict';
var EventBroker = require('broker');
var mongoose = require('hoist-model')._mongoose;
var config = require('config');
var logger = require('hoist-logger');

mongoose.set('debug', true);
mongoose.connect(config.get('Hoist.mongo.db'), function subscribeToEvents(err) {
  /* istanbul ignore if */
  if (err) {
    logger.alert(err);
    logger.error(err);
  }

  EventBroker.ModelResolver.set(require('hoist-model'));
  var eventBroker = new EventBroker();
  eventBroker.listen(EventBroker.events.ApplicationEvent, function () {
    logger.info('listening');
  });
});
