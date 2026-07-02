const test = require('node:test');
const assert = require('node:assert');

const {
  createAuth,
  decodeAudioFrame,
  encodeAudioFrame,
  verifyAuth
} = require('../src/voiceRelay/link/protocol');
const {
  evaluateSpeaker,
  pickActiveSpeakers,
  resolveTargets
} = require('../src/voiceRelay/discord/rules');

function member({ bot = false, roles = [] } = {}) {
  return {
    user: { bot },
    roles: { cache: new Map(roles.map((id) => [id, { id }])) }
  };
}

test('protocol: audio frame round-trip giữ nguyên userId và payload', () => {
  const payload = Buffer.from([1, 2, 3, 4, 5]);
  const decoded = decodeAudioFrame(encodeAudioFrame('123456789012345678', payload));
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

test('rules: bridge tới bot còn lại, broadcast theo relay_targets', () => {
  assert.deepStrictEqual(resolveTargets({ mode: 'bridge' }, 1), [2]);
  assert.deepStrictEqual(resolveTargets({ mode: 'bridge' }, 2), [1]);
  assert.deepStrictEqual(resolveTargets({ mode: 'broadcast', relay_targets: ['2'] }, 1), [2]);
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
