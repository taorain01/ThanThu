#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { RainderClient, RainderClientError } = require('../src/rainder-client');

async function main(argv = process.argv.slice(2)) {
  const action = String(argv.shift() || 'status').toLowerCase();
  const client = new RainderClient();
  if (action === 'status') {
    return client.listUploads();
  }
  if (action === 'list') {
    return client.listUploads();
  }
  if (action === 'start') {
    const requestId = `openclaw:${crypto.randomUUID()}`;
    return client.startUploads(argv, {
      source: 'openclaw',
      requestId,
      idempotencyKey: requestId,
    });
  }
  if (action === 'stop') {
    return client.stopUpload(argv[0] || '');
  }
  throw new RainderClientError('usage', 'Usage: rainder-upload.js status|list|start [item-id...]|stop [run-id]');
}

main()
  .then((payload) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  })
  .catch((error) => {
    const payload = {
      ok: false,
      code: error?.code || 'error',
      error: String(error?.message || error),
      status: error?.status || null,
      progress: error?.payload?.progress || null,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = error?.code === 'offline' ? 2 : 1;
  });
