const crypto = require('node:crypto');

const AUDIO_FRAME = 0xa1;

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

function encodeAudioFrame(userId, opus) {
  const id = Buffer.from(String(userId), 'utf8');
  if (id.length > 255) throw new Error('userId quá dài');
  const payload = Buffer.isBuffer(opus) ? opus : Buffer.from(opus);
  return Buffer.concat([Buffer.from([AUDIO_FRAME, id.length]), id, payload]);
}

function decodeAudioFrame(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (data.length < 2 || data[0] !== AUDIO_FRAME) return null;
  const idLen = data[1];
  if (data.length < 2 + idLen) return null;
  return {
    userId: data.subarray(2, 2 + idLen).toString('utf8'),
    opus: data.subarray(2 + idLen)
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
  isAudioFrame
};
