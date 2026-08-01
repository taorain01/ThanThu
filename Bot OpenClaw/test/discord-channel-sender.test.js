'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const {
  DiscordChannelSenderError,
  resolveDeliveryFiles,
  sendDiscordChannelMessage,
} = require('../src/discord-channel-sender');

const GUILD_ID = '1239836342456942643';
const CHANNEL_ID = '1533105740145758248';

function createRest(channel = {}, guildChannels = null) {
  const calls = [];
  return {
    calls,
    async get(route) {
      calls.push({ method: 'get', route });
      if (route.includes(`/guilds/${GUILD_ID}/channels`)) {
        return guildChannels || [{
          id: CHANNEL_ID,
          name: 'output-test',
          type: ChannelType.GuildText,
        }];
      }
      return {
        id: CHANNEL_ID,
        guild_id: GUILD_ID,
        name: 'output-test',
        type: ChannelType.GuildText,
        ...channel,
      };
    },
    async post(route, options) {
      calls.push({ method: 'post', route, options });
      return { id: '1534000000000000000' };
    },
  };
}

test('gửi nội dung và file tới text channel cùng server', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-channel-sender-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const image = path.join(root, 'ảnh thành phẩm.png');
  await fs.writeFile(image, Buffer.from('test-image'));
  const rest = createRest();

  const result = await sendDiscordChannelMessage({
    rest,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    content: '0001 — Ảnh thành phẩm',
    filePaths: [image],
    allowedRoots: [root],
  });

  assert.equal(result.messageId, '1534000000000000000');
  assert.equal(result.channelName, 'output-test');
  assert.equal(rest.calls.length, 2);
  assert.deepEqual(rest.calls[1].options.body.allowed_mentions, { parse: [] });
  assert.equal(rest.calls[1].options.files[0].name, 'ảnh thành phẩm.png');
});

test('tìm đúng channel theo tên rồi gửi vào ID đã resolve', async () => {
  const rest = createRest({}, [
    { id: '1533000000000000001', name: 'general', type: ChannelType.GuildText },
    { id: CHANNEL_ID, name: 'output-seorachill', type: ChannelType.GuildText },
  ]);

  const result = await sendDiscordChannelMessage({
    rest,
    guildId: GUILD_ID,
    channel: '#output-seorachill',
    content: 'Gửi đúng kênh theo tên',
    allowedRoots: [],
  });

  assert.equal(result.channelId, CHANNEL_ID);
  assert.equal(result.channelName, 'output-seorachill');
  assert.match(rest.calls[1].route, new RegExp(`/channels/${CHANNEL_ID}/messages$`));
});

test('từ chối tên channel bị trùng để không gửi nhầm', async () => {
  const rest = createRest({}, [
    { id: '1533000000000000001', name: 'baocao', type: ChannelType.GuildText },
    { id: '1533000000000000002', name: 'BaoCao', type: ChannelType.GuildText },
  ]);

  await assert.rejects(
    sendDiscordChannelMessage({
      rest,
      guildId: GUILD_ID,
      channel: 'baocao',
      content: 'Không được gửi nhầm',
      allowedRoots: [],
    }),
    (error) => error instanceof DiscordChannelSenderError && error.code === 'ambiguous_channel',
  );
  assert.equal(rest.calls.filter((call) => call.method === 'post').length, 0);
});

test('từ chối channel thuộc server khác', async () => {
  const rest = createRest({ guild_id: '999999999999999999' });
  await assert.rejects(
    sendDiscordChannelMessage({
      rest,
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      content: 'Không được gửi',
      allowedRoots: [],
    }),
    (error) => error instanceof DiscordChannelSenderError && error.code === 'wrong_guild',
  );
  assert.equal(rest.calls.filter((call) => call.method === 'post').length, 0);
});

test('từ chối loại channel không nhận tin nhắn thường', async () => {
  const rest = createRest({ type: ChannelType.GuildVoice });
  await assert.rejects(
    sendDiscordChannelMessage({
      rest,
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      content: 'Không được gửi',
      allowedRoots: [],
    }),
    (error) => error instanceof DiscordChannelSenderError && error.code === 'unsupported_channel',
  );
});

test('chỉ nhận file trong các thư mục nguồn đã cho phép', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-delivery-root-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const allowedRoot = path.join(directory, 'allowed');
  const outsideRoot = path.join(directory, 'outside');
  await fs.mkdir(allowedRoot);
  await fs.mkdir(outsideRoot);
  const allowedFile = path.join(allowedRoot, 'ok.png');
  const outsideFile = path.join(outsideRoot, 'secret.txt');
  await fs.writeFile(allowedFile, Buffer.from('ok'));
  await fs.writeFile(outsideFile, Buffer.from('secret'));

  assert.deepEqual(
    (await resolveDeliveryFiles([allowedFile], { allowedRoots: [allowedRoot] }))
      .map((file) => file.name),
    ['ok.png'],
  );
  await assert.rejects(
    resolveDeliveryFiles([outsideFile], { allowedRoots: [allowedRoot] }),
    (error) => (
      error instanceof DiscordChannelSenderError
      && error.code === 'file_outside_allowed_roots'
    ),
  );
});
