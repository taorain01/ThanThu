const test = require('node:test');
const assert = require('node:assert');

const {
  createAuth,
  decodeAudioFrame,
  encodeAudioFrame,
  targetsToMask,
  verifyAuth
} = require('../src/voiceRelay/link/protocol');
const {
  evaluateSpeaker,
  pickActiveSpeakers,
  resolveTargets
} = require('../src/voiceRelay/discord/rules');

function member({ id = 'u1', bot = false, roles = [] } = {}) {
  return {
    id,
    user: { id, bot },
    roles: { cache: new Map(roles.map((id) => [id, { id }])) }
  };
}

test('protocol: audio frame round-trip giữ nguyên nguồn, đích, userId và payload', () => {
  const payload = Buffer.from([1, 2, 3, 4, 5]);
  const decoded = decodeAudioFrame(encodeAudioFrame(1, targetsToMask([2, 3]), '123456789012345678', payload));
  assert.strictEqual(decoded.srcBotId, 1);
  assert.deepStrictEqual(decoded.targets, [2, 3]);
  assert.strictEqual(decoded.userId, '123456789012345678');
  assert.deepStrictEqual(decoded.opus, payload);
});

test('protocol: HMAC đúng thì pass, sai secret thì fail', () => {
  const auth = createAuth('secret-a', 1, 'nonce');
  assert.strictEqual(verifyAuth('secret-a', 1, 'nonce', auth), true);
  assert.strictEqual(verifyAuth('secret-b', 1, 'nonce', auth), false);
});

test('rules: caller hợp lệ, bot/blocked/missing role bị chặn', () => {
  const config = { caller_role_ids: ['caller'], blocked_role_ids: ['blocked'] };
  assert.strictEqual(evaluateSpeaker(member({ roles: ['caller'] }), config).allowed, true);
  assert.strictEqual(evaluateSpeaker(member({ bot: true, roles: ['caller'] }), config).allowed, false);
  assert.strictEqual(evaluateSpeaker(member({ roles: ['caller', 'blocked'] }), config).allowed, false);
  assert.strictEqual(evaluateSpeaker(member({ roles: ['listener'] }), config).allowed, false);
});

test('rules: user allow riêng và mute riêng', () => {
  assert.strictEqual(evaluateSpeaker(member({ id: 'u1', roles: [] }), {
    caller_role_ids: [],
    caller_user_ids: ['u1'],
    muted_user_ids: []
  }).allowed, true);
  assert.strictEqual(evaluateSpeaker(member({ id: 'u1', roles: ['caller'] }), {
    caller_role_ids: ['caller'],
    caller_user_ids: ['u1'],
    muted_user_ids: ['u1']
  }).allowed, false);
});

test('rules: bridge mesh tới mọi bot còn lại, broadcast theo relay_targets', () => {
  assert.deepStrictEqual(resolveTargets({ mode: 'bridge' }, 1), [2, 3]);
  assert.deepStrictEqual(resolveTargets({ mode: 'bridge' }, 2), [1, 3]);
  assert.deepStrictEqual(resolveTargets({ mode: 'broadcast', relay_targets: ['2', '3'] }, 1), [2, 3]);
  assert.deepStrictEqual(resolveTargets({ mode: 'broadcast', relay_targets: ['1', '2', '3'] }, 2), [1, 3]);
});

test('rules: priority chỉ giữ speaker có role ưu tiên cao nhất', () => {
  const speakers = [
    { userId: 'a', roleIds: ['low'] },
    { userId: 'b', roleIds: ['high'] },
    { userId: 'c', roleIds: ['none'] }
  ];
  const picked = pickActiveSpeakers(speakers, {
    speaker_priority: 'priority',
    priority_role_ids: ['high', 'low']
  });
  assert.deepStrictEqual(picked.map((x) => x.userId), ['b']);
});
