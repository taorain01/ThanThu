const test = require('node:test');
const assert = require('node:assert');

const { sanitizeConfig, toStringArray, getAdminAllowlist, buildSaveAllRows } = require('../api/voice-config.js');

function validBotConfig(botId) {
  return {
    voice_channel_id: String(1000 + botId),
    mode: 'bridge',
    caller_role_ids: ['role-kycuu'],
    caller_user_ids: [],
    relay_targets: [1, 2, 3].filter((id) => id !== botId).map(String),
    relay_enabled: true,
    auto_join: true,
    command_prefix: botId === 1 ? '?relay' : botId === 2 ? '!relay' : '#relay'
  };
}

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
    caller_user_ids: ['u1'],
    muted_user_ids: ['u2'],
    relay_enabled: 'yes',      // không phải true -> false
    auto_join: true,
    command_prefix: '?relay',
    hacker_field: 'drop table'  // field lạ bị loại
  });
  assert.strictEqual(clean.voice_channel_id, '123');
  assert.strictEqual(clean.mode, 'bridge');
  assert.deepStrictEqual(clean.caller_role_ids, ['r1', 'r2']);
  assert.deepStrictEqual(clean.caller_user_ids, ['u1']);
  assert.deepStrictEqual(clean.muted_user_ids, ['u2']);
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

test('buildSaveAllRows: nhận đủ 3 config hợp lệ', () => {
  const rows = buildSaveAllRows('guild-1', {
    configs: {
      1: validBotConfig(1),
      2: validBotConfig(2),
      3: validBotConfig(3)
    }
  });
  assert.deepStrictEqual(rows.map((row) => row.bot_id), [1, 2, 3]);
  assert.ok(rows.every((row) => row.guild_id === 'guild-1' && row.updated_at));
  assert.deepStrictEqual(rows[0].relay_targets, ['2', '3']);
});

test('buildSaveAllRows: thiếu bot bất kỳ -> lỗi 400', () => {
  assert.throws(
    () => buildSaveAllRows('guild-1', {
      configs: {
        1: validBotConfig(1),
        3: validBotConfig(3)
      }
    }),
    (e) => e.statusCode === 400 && /Bot 2/.test(e.message)
  );
});

test('buildSaveAllRows: draft bot không hợp lệ -> lỗi trước upsert', () => {
  assert.throws(
    () => buildSaveAllRows('guild-1', {
      configs: {
        1: validBotConfig(1),
        2: { ...validBotConfig(2), mode: 'invalid' },
        3: validBotConfig(3)
      }
    }),
    (e) => e.statusCode === 400
  );
});
