'use strict';
var kue = require('kue');
var BBPromise = require('bluebird');
var jobs;


module.exports = {
  get: function () {
    return jobs || (jobs = BBPromise.promisifyAll(kue.createQueue()));
  }
};