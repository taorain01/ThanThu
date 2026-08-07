'use strict';

/**
 * Xóa message của bot trong channel thuộc guild đã cấu hình.
 * Dùng chung config/token với send-discord-message.js — không in token ra log.
 *
 * node delete-discord-message.js --channel <id|name> --message <id> [--message <id> ...] [--dry-run]
 */

const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const { REST, Routes } = require('discord.js');

const BOT_ROOT = path.resolve('C:/Bot Discord/Bot OpenClaw');
const { loadConfig } = require(path.join(BOT_ROOT, 'src/config'));

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Thiếu giá trị cho ${name}.`);
  return value;
}

function parseArgs(argv) {
  const result = { messageIds: [], dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--channel') {
      result.channel = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--message') {
      result.messageIds.push(takeValue(argv, index, arg));
      index += 1;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      throw new Error(`Tham số không hợp lệ: ${arg}`);
    }
  }
  return result;
}

async function resolveChannel(rest, guildId, channelRef) {
  const raw = String(channelRef).trim().replace(/^<#/, '').replace(/>$/, '').replace(/^#/, '');
  const channels = await rest.get(Routes.guildChannels(guildId));
  const byId = channels.find((c) => c.id === raw);
  if (byId) return byId;
  const matches = channels.filter((c) => c.name === raw);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Tên channel trùng (${matches.length}), hãy dùng ID.`);
  throw new Error('channel_not_found');
}

async function main() {
  dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  if (!args.channel) throw new Error('Thiếu --channel.');
  if (!args.messageIds.length) throw new Error('Thiếu --message.');

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const channel = await resolveChannel(rest, config.guildId, args.channel);

  const results = [];
  for (const messageId of args.messageIds) {
    if (args.dryRun) {
      results.push({ messageId, deleted: false, dryRun: true });
      continue;
    }
    try {
      await rest.delete(Routes.channelMessage(channel.id, messageId));
      results.push({ messageId, deleted: true });
    } catch (error) {
      results.push({ messageId, deleted: false, error: error?.rawError?.message || error?.message || 'unknown' });
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: results.every((r) => r.deleted || r.dryRun),
    dryRun: args.dryRun,
    channelId: channel.id,
    channelName: channel.name,
    results,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'delete_failed', message: error?.message || 'unknown' }, null, 2)}\n`);
  process.exitCode = 1;
});
