'use strict';
var Model = require('hoist-model');
var BBPromise = require('bluebird');
var _ = require('lodash');
module.exports = {
  loadApplication: function (applicationId) {
    return BBPromise.resolve(Model.Application.findOne({
        _id: applicationId
      })
      .populate('organisation')
      .exec());
  },
  loadModuleDescriptions: function (application, moduleNames) {
    return module.exports.loadSettings(application)
      .then(function (settings) {
        return _.filter(_.map(moduleNames, function (moduleName) {
          return _.find(settings.modules, function (moduleDesc) {
            return moduleDesc.name === moduleName;
          });
        }));
      });
  },
  loadSettings: function (application) {
    return BBPromise.try(function () {
      if (!application.settings) {
        throw new Error('settings not found for application');
      }
      var liveSettings = application.settings.live;
      if (!liveSettings) {
        throw new Error('live settings not found for application');
      }
      return liveSettings;
    });

  },
  getModulesToRunForEvent: function (application, eventName) {
    return module.exports.loadSettings(application)
      .then(function (settings) {
        if (!settings.on || !settings.on[eventName]) {
          //don't do anything for this event
          return [];
        }
        return settings.on[eventName].modules || [];
      });
  }
};
