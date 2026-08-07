'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_CACHE_HITS,
  buildCandidates,
  resolveTingExpiry,
} = require('../scripts/rotate-gpt-account');

const EMAIL = 'acc-demo@icloud.com';

// ---------------------------------------------------------------------------
// resolveTingExpiry — hạn hiệu lực = mốc đã xác nhận, cache chỉ nâng lên
// ---------------------------------------------------------------------------

test('cache ít hit (dữ liệu cụt) không được kết luận hết hạn khi chưa có ký ức', () => {
  const entry = { email: EMAIL, expiryDate: '2026-08-02', hits: 1 };
  const result = resolveTingExpiry(entry, {});
  assert.equal(result.status, 'unknown');
  assert.equal(result.expiryDate, null);
});

test('cache ít hit không được hạ hạn đã xác nhận trước đó', () => {
  const entry = { email: EMAIL, expiryDate: '2026-08-02', hits: 1 };
  const result = resolveTingExpiry(entry, { [EMAIL]: '2026-09-02' });
  assert.equal(result.status, 'active');
  assert.equal(result.expiryDate, '2026-09-02');
});

test('cache đủ hit nâng hạn lên mốc lớn hơn đã biết', () => {
  const entry = { email: EMAIL, expiryDate: '2026-09-02', hits: MIN_CACHE_HITS + 1 };
  const result = resolveTingExpiry(entry, { [EMAIL]: '2026-08-16' });
  assert.equal(result.expiryDate, '2026-09-02');
  assert.equal(result.status, 'active');
});

test('cache đủ hit với hạn quá khứ vẫn báo expired (không có ký ức cản)', () => {
  const entry = { email: EMAIL, expiryDate: '2026-07-01', hits: MIN_CACHE_HITS + 1 };
  const result = resolveTingExpiry(entry, {});
  assert.equal(result.status, 'expired');
  assert.equal(result.expiryDate, '2026-07-01');
});

// ---------------------------------------------------------------------------
// buildCandidates — mâu thuẫn nguồn: Ting! hết hạn nhưng quota + token còn
// ---------------------------------------------------------------------------

function makeAuth(overrides = {}) {
  return {
    profiles: [{
      id: 'openai:demo',
      email: EMAIL,
      plan: 'plus',
      tokenExpiresAt: overrides.tokenExpiresAt ?? '2026-12-01T00:00:00.000Z',
      lastUsedMs: 0,
    }],
    lastGood: null,
  };
}

function makeNine(overrides = {}) {
  return {
    available: true,
    connections: [{
      id: 'conn-1',
      email: EMAIL,
      priority: 1,
      quota: overrides.quota ?? { limitReached: false, remaining: 60, total: 100, used: 40, resetAt: null },
    }],
  };
}

function makeTing(overrides = {}) {
  return {
    available: true,
    accounts: {
      [EMAIL]: {
        expiryDate: '2026-08-02',
        daysLeft: -1,
        status: 'expired',
        cacheHits: 1,
        ...overrides,
      },
    },
  };
}

test('hết hạn theo Ting! nhưng quota còn và token sống → không loại, chỉ ghi chú', () => {
  const candidates = buildCandidates({
    auth: makeAuth(),
    ninerouter: makeNine(),
    ting: makeTing(),
    failedEmails: [],
  });
  const entry = candidates.find((c) => c.email === EMAIL);
  assert.equal(entry.usable, true);
  assert.deepEqual(entry.reasons, []);
  assert.deepEqual(entry.notes, ['ting_het_han_2026-08-02_nhung_quota_con']);
});

test('hết hạn theo Ting! + quota cũng hết → loại vì ting', () => {
  const candidates = buildCandidates({
    auth: makeAuth(),
    ninerouter: makeNine({ quota: { limitReached: true, remaining: 0, total: 100, used: 100, resetAt: null } }),
    ting: makeTing(),
    failedEmails: [],
  });
  const entry = candidates.find((c) => c.email === EMAIL);
  assert.equal(entry.usable, false);
  assert.ok(entry.reasons.includes('ting_het_han_2026-08-02'));
});

test('hết hạn theo Ting! + không có quota 9router → loại vì ting', () => {
  const candidates = buildCandidates({
    auth: makeAuth(),
    ninerouter: { available: true, connections: [] },
    ting: makeTing(),
    failedEmails: [],
  });
  const entry = candidates.find((c) => c.email === EMAIL);
  assert.equal(entry.usable, false);
  assert.ok(entry.reasons.includes('ting_het_han_2026-08-02'));
});

test('hết hạn theo Ting! + quota còn nhưng token đã hết hạn → loại vì ting', () => {
  const candidates = buildCandidates({
    auth: makeAuth({ tokenExpiresAt: '2026-07-01T00:00:00.000Z' }),
    ninerouter: makeNine(),
    ting: makeTing(),
    failedEmails: [],
  });
  const entry = candidates.find((c) => c.email === EMAIL);
  assert.equal(entry.usable, false);
  assert.ok(entry.reasons.includes('ting_het_han_2026-08-02'));
});

test('ting active thì không bị chặn vì hạn', () => {
  const candidates = buildCandidates({
    auth: makeAuth(),
    ninerouter: makeNine(),
    ting: makeTing({ expiryDate: '2026-09-02', daysLeft: 30, status: 'active', cacheHits: 5 }),
    failedEmails: [],
  });
  const entry = candidates.find((c) => c.email === EMAIL);
  assert.equal(entry.usable, true);
  assert.deepEqual(entry.reasons, []);
  assert.deepEqual(entry.notes, []);
});
