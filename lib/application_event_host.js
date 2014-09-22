'use strict';
var EventBroker = require('broker/lib/event_broker');
EventBroker.subscribe(require('broker/lib/event_types/application_event'),function(){
  console.log('listening');
});
