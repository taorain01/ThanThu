'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const { REST } = require('discord.js');
const { loadConfig } = require('../src/config');
const {
  DiscordChannelSenderError,
  sendDiscordChannelMessage,
} = require('../src/discord-channel-sender');

const BOT_ROOT = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Thiếu giá trị cho ${name}.`);
  }
  return value;
}

function parseArgs(argv) {
  const result = { filePaths: [], dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--channel') {
      result.channelId = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--content') {
      result.content = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--content-file') {
      result.contentFile = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--file') {
      result.filePaths.push(takeValue(argv, index, arg));
      index += 1;
    } else if (arg === '--request') {
      result.requestFile = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      throw new Error(`Tham số không hợp lệ: ${arg}`);
    }
  }
  return result;
}

async function readJsonRequest(filePath) {
  const content = await fs.readFile(path.resolve(filePath), 'utf8');
  const request = JSON.parse(content.replace(/^\uFEFF/, ''));
  return {
    channelId: request.channelId,
    content: request.content,
    filePaths: Array.isArray(request.files) ? request.files : [],
  };
}

async function buildRequest(args) {
  const fromFile = args.requestFile ? await readJsonRequest(args.requestFile) : {};
  let content = args.content ?? fromFile.content ?? '';
  if (args.contentFile) {
    content = (await fs.readFile(path.resolve(args.contentFile), 'utf8')).replace(/^\uFEFF/, '');
  }
  return {
    channelId: args.channelId || fromFile.channelId,
    content,
    filePaths: args.filePaths.length ? args.filePaths : (fromFile.filePaths || []),
    dryRun: args.dryRun,
  };
}

async function main() {
  dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const request = await buildRequest(args);
  const allowedRoots = [...new Set([
    path.join(OPENCLAW_HOME, 'workspace'),
    path.join(OPENCLAW_HOME, 'media'),
    ...config.mediaSourceRoots,
  ])];
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const result = await sendDiscordChannelMessage({
    rest,
    guildId: config.guildId,
    allowedRoots,
    ...request,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof DiscordChannelSenderError ? error.code : 'send_failed';
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code,
      message: error.message,
      discordCode: error.code && typeof error.code === 'number' ? error.code : undefined,
      status: error.status,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildRequest,
  parseArgs,
  readJsonRequest,
};
