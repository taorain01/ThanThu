const crypto = require('node:crypto');

const AUDIO_FRAME = 0xa1;
const ALL_BOT_IDS = [1, 2, 3];

function createAuth(secret, botId, nonce) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${botId}:${nonce}`)
    .digest('hex');
}

function verifyAuth(secret, botId, nonce, auth) {
  const expected = Buffer.from(createAuth(secret, botId, nonce), 'hex');
  const actual = Buffer.from(String(auth || ''), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function targetsToMask(targets) {
  return (Array.isArray(targets) ? targets : [targets])
    .map(Number)
    .filter((id) => ALL_BOT_IDS.includes(id))
    .reduce((mask, id) => mask | (1 << (id - 1)), 0);
}

function maskToTargets(mask) {
  const n = Number(mask) || 0;
  return ALL_BOT_IDS.filter((id) => (n & (1 << (id - 1))) !== 0);
}

function encodeAudioFrame(srcBotId, targetsMask, userId, opus) {
  const id = Buffer.from(String(userId), 'utf8');
  if (id.length > 255) throw new Error('userId quá dài');
  const payload = Buffer.isBuffer(opus) ? opus : Buffer.from(opus);
  return Buffer.concat([Buffer.from([AUDIO_FRAME, Number(srcBotId) || 0, Number(targetsMask) || 0, id.length]), id, payload]);
}

function decodeAudioFrame(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (data.length < 4 || data[0] !== AUDIO_FRAME) return null;
  const srcBotId = Number(data[1]);
  const targetsMask = Number(data[2]);
  const idLen = data[3];
  if (data.length < 4 + idLen) return null;
  return {
    srcBotId,
    targetsMask,
    targets: maskToTargets(targetsMask),
    userId: data.subarray(4, 4 + idLen).toString('utf8'),
    opus: data.subarray(4 + idLen)
  };
}

function isAudioFrame(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return data.length > 0 && data[0] === AUDIO_FRAME;
}

module.exports = {
  AUDIO_FRAME,
  createAuth,
  verifyAuth,
  encodeAudioFrame,
  decodeAudioFrame,
  isAudioFrame,
  targetsToMask,
  maskToTargets
};
