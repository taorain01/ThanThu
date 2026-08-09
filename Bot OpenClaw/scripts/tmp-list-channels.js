'use strict';
const path = require('node:path');
const dotenv = require('dotenv');
const { REST, Routes } = require('discord.js');
const BOT_ROOT = path.resolve('C:/Bot Discord/Bot OpenClaw');
const { loadConfig } = require(path.join(BOT_ROOT, 'src/config'));

async function main() {
  dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const channels = await rest.get(Routes.guildChannels(config.guildId));
  const out = channels
    .filter((c) => c.type === 0 || c.type === 5)
    .map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id }));
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}
main().catch((e) => { process.stdout.write(`ERR ${e?.message}\n`); process.exitCode = 1; });
