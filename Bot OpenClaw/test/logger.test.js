'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../src/logger');

test('che token và authorization trong log', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-openclaw-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, 'bot.log');
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = originalLog; });

  const logger = createLogger(logPath);
  logger.info('Kiểm tra', {
    gatewayToken: 'gateway-secret-value',
    nested: { authorization: 'Bearer discord-secret-value' },
    status: 200,
  });

  const content = await fs.readFile(logPath, 'utf8');
  assert.equal(content.includes('gateway-secret-value'), false);
  assert.equal(content.includes('discord-secret-value'), false);
  assert.match(content, /\[REDACTED\]/);
  assert.match(content, /"status":200/);
});
