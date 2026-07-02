const test = require('node:test');
const assert = require('node:assert');

const { sanitizeConfig, toStringArray, getAdminAllowlist } = require('../api/voice-config.js');

test('toStringArray: chấp nhận mảng, chuỗi JSON, loại rỗng', () => {
  assert.deepStrictEqual(toStringArray(['1', '2']), ['1', '2']);
  assert.deepStrictEqual(toStringArray('["3","4"]'), ['3', '4']);
  assert.deepStrictEqual(toStringArray([1, '', '  ', 5]), ['1', '5']);
  assert.deepStrictEqual(toStringArray('not-json'), []);
  assert.deepStrictEqual(toStringArray(undefined), []);
});

test('sanitizeConfig: chỉ giữ field hợp lệ, ép kiểu đúng', () => {
  const clean = sanitizeConfig({
    voice_channel_id: '123',
    mode: 'bridge',
    caller_role_ids: ['r1', 'r2'],
    blocked_role_ids: [],
    relay_enabled: 'yes',      // không phải true -> false
    auto_join: true,
    command_prefix: '?relay',
    hacker_field: 'drop table'  // field lạ bị loại
  });
  assert.strictEqual(clean.voice_channel_id, '123');
  assert.strictEqual(clean.mode, 'bridge');
  assert.deepStrictEqual(clean.caller_role_ids, ['r1', 'r2']);
  assert.strictEqual(clean.relay_enabled, false);
  assert.strictEqual(clean.auto_join, true);
  assert.strictEqual(clean.command_prefix, '?relay');
  assert.ok(!('hacker_field' in clean));
  assert.ok(clean.updated_at);
});

test('sanitizeConfig: mode không hợp lệ -> lỗi 400', () => {
  assert.throws(() => sanitizeConfig({ mode: 'invalid' }), (e) => e.statusCode === 400);
});

test('sanitizeConfig: speaker_priority không hợp lệ -> lỗi 400', () => {
  assert.throws(() => sanitizeConfig({ speaker_priority: 'loudest' }), (e) => e.statusCode === 400);
});

test('sanitizeConfig: broadcast không có đích -> lỗi 400 (R9.6)', () => {
  assert.throws(
    () => sanitizeConfig({ mode: 'broadcast', relay_targets: [] }),
    (e) => e.statusCode === 400
  );
});

test('sanitizeConfig: broadcast có đích -> hợp lệ', () => {
  const clean = sanitizeConfig({ mode: 'broadcast', relay_targets: ['2'] });
  assert.strictEqual(clean.mode, 'broadcast');
  assert.deepStrictEqual(clean.relay_targets, ['2']);
});

test('sanitizeConfig: payload rỗng -> lỗi 400', () => {
  assert.throws(() => sanitizeConfig({}), (e) => e.statusCode === 400);
});

test('getAdminAllowlist: dùng env khi có, fallback khi không', () => {
  const prev = process.env.VOICE_ADMIN_DISCORD_IDS;
  process.env.VOICE_ADMIN_DISCORD_IDS = '111, 222 333';
  const set = getAdminAllowlist();
  assert.ok(set.has('111') && set.has('222') && set.has('333'));
  delete process.env.VOICE_ADMIN_DISCORD_IDS;
  assert.ok(getAdminAllowlist().size >= 1); // fallback không rỗng
  if (prev !== undefined) process.env.VOICE_ADMIN_DISCORD_IDS = prev;
});
