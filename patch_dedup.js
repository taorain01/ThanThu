// Script: Them dedup guard vao ready.js de chong gui thong bao 3 lan
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'events', 'client', 'ready.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Them _sessionNotifDedup Map sau dong require cuoi
const requireAnchor = "const { ensureTrackedMemberFromDiscord, syncStoredPositionForMember } = require('../../utils/discordPositionSync');";
if (!code.includes('_sessionNotifDedup')) {
  code = code.replace(
    requireAnchor,
    requireAnchor + '\n\n// Dedup guard: chong gui thong bao trung lap khi bot nhan nhieu realtime event\nconst _sessionNotifDedup = new Map();'
  );
  console.log('[1/2] Da them _sessionNotifDedup Map');
} else {
  console.log('[1/2] _sessionNotifDedup da ton tai, bo qua');
}

// 2. Them dedup logic vao sendSessionChangeSummaries
const oldStart = 'async function sendSessionChangeSummaries(client, guild, session, summaries = []) {\r\n  if (!session?.channel_id || !summaries.length) return;\r\n  const channel = await client.channels.fetch(session.channel_id)';
const newStart = `async function sendSessionChangeSummaries(client, guild, session, summaries = []) {\r\n  if (!session?.channel_id || !summaries.length) return;\r\n\r\n  // Dedup: chong gui trung trong 5 giay\r\n  const dedupKey = session.day || session.party_key || 'x';\r\n  const dedupHash = summaries.join('|');\r\n  const _last = _sessionNotifDedup.get(dedupKey);\r\n  if (_last && _last.h === dedupHash && Date.now() - _last.t < 5000) {\r\n    console.log('[Supabase] Skip dup notif ' + dedupKey);\r\n    return;\r\n  }\r\n  _sessionNotifDedup.set(dedupKey, { h: dedupHash, t: Date.now() });\r\n\r\n  const channel = await client.channels.fetch(session.channel_id)`;

if (code.includes(oldStart)) {
  code = code.replace(oldStart, newStart);
  console.log('[2/2] Da them dedup guard vao sendSessionChangeSummaries');
} else {
  console.log('[2/2] FAIL: Khong tim thay anchor. Thu tim khac...');
  // Fallback: tim theo dong ngan hon
  const anchor2 = '  if (!session?.channel_id || !summaries.length) return;\r\n  const channel = await client.channels.fetch';
  if (code.includes(anchor2) && !code.includes('dedupKey')) {
    code = code.replace(
      anchor2,
      `  if (!session?.channel_id || !summaries.length) return;\r\n\r\n  // Dedup: chong gui trung trong 5 giay\r\n  const dedupKey = session.day || session.party_key || 'x';\r\n  const dedupHash = summaries.join('|');\r\n  const _last = _sessionNotifDedup.get(dedupKey);\r\n  if (_last && _last.h === dedupHash && Date.now() - _last.t < 5000) {\r\n    console.log('[Supabase] Skip dup notif ' + dedupKey);\r\n    return;\r\n  }\r\n  _sessionNotifDedup.set(dedupKey, { h: dedupHash, t: Date.now() });\r\n\r\n  const channel = await client.channels.fetch`
    );
    console.log('[2/2] Da them dedup guard (method 2)');
  } else if (code.includes('dedupKey')) {
    console.log('[2/2] Dedup guard da ton tai, bo qua');
  } else {
    console.log('[2/2] FAIL: Khong the patch');
  }
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('DONE. File saved.');
