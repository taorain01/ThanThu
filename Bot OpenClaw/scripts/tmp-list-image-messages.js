'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { REST, Routes } = require('discord.js');
const BOT_ROOT = path.resolve('C:/Bot Discord/Bot OpenClaw');
const { loadConfig } = require(path.join(BOT_ROOT, 'src/config'));

async function main() {
  dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });
  const config = loadConfig();
  const channelId = process.argv[2];
  const outFile = process.argv[3];
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  let before;
  const all = [];
  for (let i = 0; i < 40; i += 1) {
    const q = new URLSearchParams({ limit: '100' });
    if (before) q.set('before', before);
    const batch = await rest.get(`${Routes.channelMessages(channelId)}?${q.toString()}`);
    if (!batch.length) break;
    all.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  const withFiles = all
    .filter((m) => (m.attachments || []).length)
    .map((m) => ({
      id: m.id,
      ts: m.timestamp,
      content: m.content || '',
      files: m.attachments.map((a) => a.filename),
    }));
  const payload = { channelId, totalScanned: all.length, withFiles: withFiles.length, messages: withFiles };
  const json = JSON.stringify(payload, null, 2);
  if (outFile) fs.writeFileSync(outFile, json, 'utf8');
  process.stdout.write(`scanned=${all.length} withFiles=${withFiles.length}\n`);
}
main().catch((e) => { process.stdout.write(`ERR ${e?.message}\n`); process.exitCode = 1; });
