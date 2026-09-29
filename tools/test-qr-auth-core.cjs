const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const core = require('../auth-service/auth_core');

test('QR payload accepts only the official scan result URL and extracts its one-time key', () => {
  const url = 'https://m.tripdata.app/scanCodeResult?type=1&key=0123456789abcdef0123456789abcdef';
  const parsed = core._test.qrPayload({ ret: 200, data: { key: url } });
  assert.equal(parsed.url, url);
  assert.equal(parsed.key, '0123456789abcdef0123456789abcdef');
  assert.throws(() => core._test.qrPayload({ ret: 200, data: { key: 'https://example.com/?key=0123456789abcdef' } }), /不支持/);
  assert.throws(() => core._test.qrPayload({ ret: 500, msg: 'failed' }), /failed/);
});

test('QR session parser finds the official token object without accepting incomplete credentials', () => {
  const session = core._test.findSession({ data: { UserInfo: { Token: { UID: 42, Token: 'session', Sign: 'signed', Gid: 7, Expire: 999 } } } }, 0);
  assert.deepEqual(session, { uid: 42, token: 'session', sign: 'signed', gid: 7, expire: 999 });
  assert.equal(core._test.findSession({ uid: 42, token: 'session' }, 0), null);
});

test('QR keys are constrained before they can reach an API request', () => {
  assert.equal(core._test.validateKey('0123456789abcdef0123456789abcdef'), true);
  assert.equal(core._test.validateKey('https://example.com/?key=x'), false);
  assert.equal(core._test.validateKey('short'), false);
});

test('MD5 helper matches Node crypto and the official API query uses stable encoding', () => {
  const text = 'key=0123456789abcdef&_t=123456';
  const expected = crypto.createHash('md5').update(text + '123456' + 'private-test').digest('hex');
  assert.equal(core._test.md5(text + '123456' + 'private-test'), expected);
  assert.equal(core._test.encodeQuery({ key: 'a b', _t: 123 }), 'key=a%20b&_t=123');
});
