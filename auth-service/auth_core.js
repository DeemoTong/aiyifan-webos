/* Official QR sign-in protocol bridge. Uses only fixed iyf.tv API routes. */
'use strict';

var https = require('https');
var crypto = require('crypto');
var API_ORIGIN = 'https://api.tripdata.app';
var configCache = null;
var deviceId = 'webos-' + crypto.randomBytes(12).toString('hex');

function md5(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex');
}

function encodeQuery(params) {
  return Object.keys(params).map(function (name) {
    return encodeURIComponent(name) + '=' + encodeURIComponent(String(params[name]));
  }).join('&');
}

function requestJson(path, query, headers) {
  return new Promise(function (resolve, reject) {
    var url = API_ORIGIN + path + (query ? '?' + query : '');
    var req = https.request(url, { method: 'GET', headers: headers || {}, timeout: 15000 }, function (res) {
      var chunks = [];
      var size = 0;
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        var body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { reject(new Error('爱壹帆返回了无法识别的数据')); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('爱壹帆扫码服务暂不可用（HTTP ' + res.statusCode + '）'));
          return;
        }
        resolve(body);
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function () { reject(new Error('无法连接爱壹帆扫码登录服务')); });
    req.end();
  });
}

function firstConfigRow(body) {
  var data = body && body.data;
  if (!data) return null;
  var rows = data.info || data.list;
  if (Array.isArray(rows)) return rows[0] || null;
  if (rows && typeof rows === 'object') return rows;
  return data;
}

function loadConfig() {
  if (configCache) return Promise.resolve(configCache);
  return requestJson('/api/home/config').then(function (body) {
    var row = firstConfigRow(body);
    var config = row && (row.pConfig || row.config || row);
    var privateKey = config && config.privateKey;
    if (Array.isArray(privateKey)) privateKey = privateKey[0];
    if (!config || !config.publicKey || !privateKey) throw new Error('爱壹帆登录配置暂不可用');
    configCache = { publicKey: String(config.publicKey), privateKey: String(privateKey) };
    return configCache;
  });
}

function signedRequest(path, params) {
  return loadConfig().then(function (config) {
    var timestamp = String(Date.now());
    var query = encodeQuery(params || {});
    query += (query ? '&' : '') + '_t=' + timestamp;
    var signature = md5(query + timestamp + config.privateKey);
    var headers = {
      'x-timestamp': timestamp,
      'x-pub': config.publicKey,
      'x-sign': signature,
      'BundleId': 'com.personal.iyftv',
      'AppVersion': '0.1.10',
      'DeviceInfo': JSON.stringify({ platform: 'webOS', device: 'LG webOS TV' }),
      'Version': 'TV3',
      'System': 'TV',
      'DeviceId': deviceId
    };
    return requestJson(path, query, headers);
  });
}

function qrPayload(body) {
  if (!body || Number(body.ret) !== 200 || !body.data || typeof body.data.key !== 'string') {
    throw new Error(body && body.msg || '爱壹帆没有返回二维码');
  }
  var url;
  try { url = new URL(body.data.key); }
  catch (_) { throw new Error('爱壹帆返回的二维码地址无效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'm.tripdata.app' || url.pathname !== '/scanCodeResult') {
    throw new Error('爱壹帆返回了不支持的二维码地址');
  }
  var key = url.searchParams.get('key');
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error('二维码授权标识无效');
  return { key: key, url: url.toString() };
}

function findSession(value, depth) {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  var keys = Object.keys(value);
  var fields = {};
  keys.forEach(function (key) { fields[key.toLowerCase()] = value[key]; });
  var uid = fields.uid;
  var token = fields.token;
  var sign = fields.sign;
  if (Number(uid) > 0 && typeof token === 'string' && token && typeof sign === 'string' && sign) {
    return {
      uid: Number(uid),
      token: token,
      sign: sign,
      gid: fields.gid,
      expire: fields.expire
    };
  }
  for (var i = 0; i < keys.length; i += 1) {
    var result = findSession(value[keys[i]], depth + 1);
    if (result) return result;
  }
  return null;
}

function validateKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key);
}

function getQrCode() {
  return signedRequest('/api/login/GetQrCode', {}).then(qrPayload);
}

function pollQrCode(key) {
  if (!validateKey(key)) return Promise.reject(new Error('二维码授权标识无效'));
  return signedRequest('/api/login/GetAuthInfo', { key: key }).then(function (body) {
    var status = Number(body && body.ret);
    if (status === 200) {
      var session = findSession(body.data, 0);
      if (session) return { status: 'authorized', session: session };
      return { status: 'pending' };
    }
    // The official service returns 7004 while the newly issued QR is awaiting approval.
    if (status === 7004) return { status: 'pending' };
    throw new Error(body && body.msg || '爱壹帆扫码状态查询失败');
  });
}

function invalidateQrCode(key) {
  if (!validateKey(key)) return Promise.resolve({ invalidated: false });
  return signedRequest('/api/login/InvalidKey', { key: key }).then(function (body) {
    return { invalidated: Number(body && body.ret) === 200 };
  });
}

module.exports = {
  getQrCode: getQrCode,
  pollQrCode: pollQrCode,
  invalidateQrCode: invalidateQrCode,
  _test: { md5: md5, encodeQuery: encodeQuery, qrPayload: qrPayload, findSession: findSession, validateKey: validateKey }
};
