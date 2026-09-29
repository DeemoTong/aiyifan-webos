'use strict';

var Service = require('webos-service');
var core = require('./auth_core');
var service = new Service('com.personal.iyftv.auth');

function respond(message, operation) {
  Promise.resolve().then(operation).then(function (result) {
    message.respond(Object.assign({ returnValue: true }, result || {}));
  }).catch(function (error) {
    message.respond({ returnValue: false, errorText: error && error.message || '扫码登录服务失败' });
  });
}

service.register('getQrCode', function (message) {
  respond(message, function () { return core.getQrCode(); });
});

service.register('getAuthInfo', function (message) {
  respond(message, function () { return core.pollQrCode(message.payload && message.payload.key); });
});

service.register('invalidateQrCode', function (message) {
  respond(message, function () { return core.invalidateQrCode(message.payload && message.payload.key); });
});
