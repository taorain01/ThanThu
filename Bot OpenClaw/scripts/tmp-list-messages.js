'use strict';
const path = require('node:path');
const dotenv = require('dotenv');
const { REST, Routes } = require('discord.js');
const BOT_ROOT = path.resolve('C:/Bot Discord/Bot OpenClaw');
const { loadConfig } = require(path.join(BOT_ROOT, 'src/config'));

async function main() {
  dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });
  const config = loadConfig();
  const channelId = process.argv[2];
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  let before;
  const all = [];
  for (let i = 0; i < 20; i += 1) {
    const q = new URLSearchParams({ limit: '100' });
    if (before) q.set('before', before);
    const batch = await rest.get(`${Routes.channelMessages(channelId)}?${q.toString()}`);
    if (!batch.length) break;
    all.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  const out = all.map((m) => ({
    id: m.id,
    author: m.author?.username,
    bot: !!m.author?.bot,
    ts: m.timestamp,
    content: (m.content || '').slice(0, 80),
    files: (m.attachments || []).map((a) => a.filename),
  }));
  process.stdout.write(`${JSON.stringify({ total: out.length, messages: out }, null, 2)}\n`);
}
main().catch((e) => { process.stdout.write(`ERR ${e?.message}\n`); process.exitCode = 1; });
