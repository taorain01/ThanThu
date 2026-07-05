const test = require('node:test');
const assert = require('node:assert');

const {
  sanitizeConfig,
  toStringArray,
  getAdminAllowlist,
  isKcPosition,
  canAccessVoiceConfig,
  buildSaveAllRows,
  buildQuickSetupRows,
  buildGlobalStopRows,
  upsertVoiceRelayConfig
} = require('../api/voice-config.js');

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

test('sanitizeConfig: speaker_release_ms nhận 0 và clamp số dương', () => {
  assert.strictEqual(sanitizeConfig({ speaker_release_ms: 0 }).speaker_release_ms, 0);
  assert.strictEqual(sanitizeConfig({ speaker_release_ms: '0' }).speaker_release_ms, 0);
  assert.strictEqual(sanitizeConfig({ speaker_release_ms: 1 }).speaker_release_ms, 100);
  assert.strictEqual(sanitizeConfig({ speaker_release_ms: 5000 }).speaker_release_ms, 3000);
  assert.strictEqual(sanitizeConfig({ speaker_release_ms: -1 }).speaker_release_ms, 500);
  assert.strictEqual(sanitizeConfig({ speaker_release_ms: 'abc' }).speaker_release_ms, 500);
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

test('isKcPosition: nhận role Kỳ Cựu từ DB', () => {
  assert.strictEqual(isKcPosition('kc'), true);
  assert.strictEqual(isKcPosition('Kỳ Cựu'), true);
  assert.strictEqual(isKcPosition('ky cuu'), true);
  assert.strictEqual(isKcPosition('mem'), false);
});

test('canAccessVoiceConfig: cho Kỳ Cựu đang hoạt động vào', async () => {
  const prev = process.env.VOICE_ADMIN_DISCORD_IDS;
  process.env.VOICE_ADMIN_DISCORD_IDS = 'admin-only';
  const chain = {
    from(table) { this.table = table; return this; },
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    limit() {
      return { data: [{ discord_id: 'user-1', position: 'kc', lang_gia_member: true, left_at: null }], error: null };
    }
  };
  assert.strictEqual(await canAccessVoiceConfig(chain, 'guild-1', 'user-1'), true);
  if (prev === undefined) delete process.env.VOICE_ADMIN_DISCORD_IDS;
  else process.env.VOICE_ADMIN_DISCORD_IDS = prev;
});

test('canAccessVoiceConfig: chặn thành viên không phải Kỳ Cựu', async () => {
  const prev = process.env.VOICE_ADMIN_DISCORD_IDS;
  process.env.VOICE_ADMIN_DISCORD_IDS = 'admin-only';
  const chain = {
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    limit() {
      return { data: [{ discord_id: 'user-1', position: 'mem', lang_gia_member: true, left_at: null }], error: null };
    }
  };
  assert.strictEqual(await canAccessVoiceConfig(chain, 'guild-1', 'user-1'), false);
  if (prev === undefined) delete process.env.VOICE_ADMIN_DISCORD_IDS;
  else process.env.VOICE_ADMIN_DISCORD_IDS = prev;
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

test('buildQuickSetupRows: auto setup gửi quickSetup cho Bot 1', () => {
  const built = buildQuickSetupRows('guild-1', {
    setup_mode: 'auto',
    voice_channel_id: 'bangchien',
    caller_role_ids: ['role-kycuu'],
    caller_user_ids: ['user-allowed']
  });
  assert.strictEqual(built.setupMode, 'auto');
  assert.deepStrictEqual(built.rows.map((row) => row.bot_id), [1, 2, 3]);
  assert.strictEqual(built.rows[0].voice_channel_id, 'bangchien');
  assert.strictEqual(built.rows[0].pending_action, 'quickSetup');
  assert.strictEqual(built.rows[1].pending_action, null);
  assert.deepStrictEqual(built.rows[2].relay_targets, ['1', '2']);
  assert.ok(built.rows.every((row) => JSON.stringify(row.caller_role_ids) === JSON.stringify(['role-kycuu'])));
  assert.ok(built.rows.every((row) => JSON.stringify(row.caller_user_ids) === JSON.stringify(['user-allowed'])));
});

test('buildQuickSetupRows: manual thiếu kênh -> lỗi 400', () => {
  assert.throws(
    () => buildQuickSetupRows('guild-1', {
      setup_mode: 'manual',
      manual_channel_ids: { 1: 'a', 2: 'b' }
    }),
    (e) => e.statusCode === 400
  );
});

test('buildQuickSetupRows: manual trùng kênh -> lỗi 400', () => {
  assert.throws(
    () => buildQuickSetupRows('guild-1', {
      setup_mode: 'manual',
      manual_channel_ids: { 1: 'a', 2: 'a', 3: 'c' }
    }),
    (e) => e.statusCode === 400
  );
});

test('buildQuickSetupRows: manual đủ 3 kênh -> cả 3 bot rejoin', () => {
  const built = buildQuickSetupRows('guild-1', {
    setup_mode: 'manual',
    manual_channel_ids: { 1: 'a', 2: 'b', 3: 'c' },
    caller_role_ids: ['role-kycuu'],
    caller_user_ids: ['user-allowed']
  });
  assert.strictEqual(built.setupMode, 'manual');
  assert.deepStrictEqual(built.rows.map((row) => row.voice_channel_id), ['a', 'b', 'c']);
  assert.ok(built.rows.every((row) => row.pending_action === 'rejoin'));
  assert.ok(built.rows.every((row) => row.relay_enabled === true && row.auto_join === true));
  assert.ok(built.rows.every((row) => JSON.stringify(row.caller_user_ids) === JSON.stringify(['user-allowed'])));
});

test('buildGlobalStopRows: tắt đủ 3 bot relay và auto_join', () => {
  const built = buildGlobalStopRows('guild-1', { mode: 'delete' });
  assert.strictEqual(built.mode, 'delete');
  assert.deepStrictEqual(built.rows.map((row) => row.bot_id), [1, 2, 3]);
  assert.ok(built.rows.every((row) => row.relay_enabled === false && row.auto_join === false));
  assert.ok(built.rows.every((row) => row.pending_action === 'stopDelete'));
});

test('upsertVoiceRelayConfig: bỏ column phụ khi Supabase schema cache chưa có', async () => {
  const attempts = [];
  const admin = {
    from(table) {
      assert.strictEqual(table, 'voice_relay_config');
      return {
        upsert(payload) {
          attempts.push(payload);
          return {
            select() {
              return {
                maybeSingle: async () => {
                  if (attempts.length === 1) {
                    return {
                      data: null,
                      error: {
                        message: "Could not find the 'speaker_release_ms' column of 'voice_relay_config' in the schema cache"
                      }
                    };
                  }
                  return { data: payload, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const result = await upsertVoiceRelayConfig(admin, {
    guild_id: 'guild-1',
    bot_id: 1,
    relay_enabled: true,
    speaker_release_ms: 700
  }, { maybeSingle: true });

  assert.deepStrictEqual(result.omittedColumns, ['speaker_release_ms']);
  assert.strictEqual(attempts.length, 2);
  assert.strictEqual(attempts[0].speaker_release_ms, 700);
  assert.ok(!('speaker_release_ms' in attempts[1]));
});
