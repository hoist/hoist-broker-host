'use strict';
var kue = require('kue');
var BBPromise = require('bluebird');
var jobs;
var config = require('config');


module.exports = {
  get: function () {
    return jobs || (jobs = BBPromise.promisifyAll(kue.createQueue({
      redis:{
        hoist:config.get('Hoist.kue.host')
      }
    })));
  }
};
