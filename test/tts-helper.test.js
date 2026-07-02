const test = require('node:test');
const assert = require('node:assert/strict');
const { VoiceConnectionStatus } = require('@discordjs/voice');

const ttsService = require('../src/utils/ttsService');
const {
  canJoinTtsChannel,
  executeTtsCommand,
  findOtherTtsBotsInChannel,
  getConfiguredTtsBotIds,
  handleTtsAutoRead,
  isRelayTtsBlocked
} = require('../src/utils/ttsCommandHelper');

const BOT1 = '111111111111111111';
const BOT2 = '222222222222222222';
const BOT3 = '333333333333333333';
const HUMAN = '444444444444444444';

function fakeMember({ id, bot = false, displayName = id }) {
  return {
    id,
    displayName,
    user: { id, bot, username: displayName }
  };
}

function fakeVoiceChannel({ id = 'voice1', name = 'Voice 1', members = [] } = {}) {
  return {
    id,
    name,
    members: new Map(members.map((member) => [member.id, member])),
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => true })
  };
}

function fakeMessage({ content = '?join', client = {}, voiceChannel, replies = [] } = {}) {
  const guild = {
    id: 'guild1',
    channels: {
      cache: new Map(),
      fetch: async () => null
    }
  };
  if (voiceChannel) voiceChannel.guild = guild;

  return {
    content,
    guild,
    channel: { id: 'text1' },
    member: { voice: { channel: voiceChannel } },
    client: { user: { id: BOT1 }, ...client },
    reply: async (payload) => {
      replies.push(typeof payload === 'string' ? payload : payload?.content || '');
      return null;
    },
    delete: async () => null
  };
}

function mockTtsService(t, patch) {
  const originals = {};
  for (const key of Object.keys(patch)) {
    originals[key] = ttsService[key];
    ttsService[key] = patch[key];
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      ttsService[key] = value;
    }
  });
}

test('TTS bot ids đọc từ TTS_BOT_IDS', () => {
  const oldValue = process.env.TTS_BOT_IDS;
  process.env.TTS_BOT_IDS = `${BOT1}, ${BOT2} ${BOT3}`;

  try {
    assert.deepEqual(getConfiguredTtsBotIds(), [BOT1, BOT2, BOT3]);
  } finally {
    if (oldValue === undefined) delete process.env.TTS_BOT_IDS;
    else process.env.TTS_BOT_IDS = oldValue;
  }
});

test('smart-join: phòng chưa có bot TTS khác thì cho join', () => {
  const channel = fakeVoiceChannel({
    members: [
      fakeMember({ id: BOT1, bot: true, displayName: 'Bot 1' }),
      fakeMember({ id: HUMAN, displayName: 'User' })
    ]
  });

  const result = canJoinTtsChannel(channel, {
    currentBotId: BOT1,
    ttsBotIds: [BOT1, BOT2, BOT3]
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
});

test('smart-join: phòng có bot TTS khác thì từ chối', () => {
  const channel = fakeVoiceChannel({
    members: [
      fakeMember({ id: BOT2, bot: true, displayName: 'Tiểu Ngỗng' })
    ]
  });

  const blockers = findOtherTtsBotsInChannel(channel, {
    currentBotId: BOT1,
    ttsBotIds: [BOT1, BOT2, BOT3]
  });

  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].displayName, 'Tiểu Ngỗng');
  assert.equal(canJoinTtsChannel(channel, { currentBotId: BOT1, ttsBotIds: [BOT1, BOT2, BOT3] }).allowed, false);
});

test('smart-join: bot hiện tại trong phòng không tự chặn chính nó', async (t) => {
  const voiceChannel = fakeVoiceChannel({
    name: 'Phòng TTS',
    members: [fakeMember({ id: BOT1, bot: true, displayName: 'Đại Ngỗng' })]
  });
  const replies = [];

  mockTtsService(t, {
    getConnection: () => ({
      state: { status: VoiceConnectionStatus.Ready },
      joinConfig: { channelId: voiceChannel.id }
    }),
    joinChannel: async () => {
      throw new Error('không được join lại khi đã ở đúng phòng');
    }
  });

  await executeTtsCommand(fakeMessage({ voiceChannel, replies }), [], {
    prefix: '?',
    botName: 'Đại Ngỗng'
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /đã ở \*\*Phòng TTS\*\* rồi/);
});

test('relay gate: chỉ chặn TTS khi runtime relay đang bật', () => {
  assert.equal(isRelayTtsBlocked(undefined), false);
  assert.equal(isRelayTtsBlocked({ voiceRelay: { enabled: false, config: { relay_enabled: true } } }), false);
  assert.equal(isRelayTtsBlocked({ voiceRelay: { enabled: true, config: { relay_enabled: false } } }), false);
  assert.equal(isRelayTtsBlocked({ voiceRelay: { enabled: true, config: { relay_enabled: true } } }), true);
});

test('relay gate: join TTS bị từ chối khi relay_enabled=true', async () => {
  const replies = [];
  const message = fakeMessage({
    replies,
    client: {
      voiceRelay: { enabled: true, config: { relay_enabled: true } }
    }
  });

  await executeTtsCommand(message, [], { prefix: '?', commandName: 'join' });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /Voice relay đang bật/);
});

test('auto-read: relay tắt thì đọc, relay bật thì chặn', async (t) => {
  const voiceChannel = fakeVoiceChannel();
  const spoken = [];
  const blockedReplies = [];

  mockTtsService(t, {
    isConnected: () => true,
    getConnection: () => ({ joinConfig: { channelId: voiceChannel.id } }),
    speak: async (guildId, text) => {
      spoken.push({ guildId, text });
      return true;
    }
  });

  const handled = await handleTtsAutoRead(fakeMessage({
    content: '.xin chào',
    voiceChannel
  }));

  assert.equal(handled, true);
  assert.deepEqual(spoken, [{ guildId: 'guild1', text: 'xin chào' }]);

  const blocked = await handleTtsAutoRead(fakeMessage({
    content: '.không đọc',
    voiceChannel,
    replies: blockedReplies,
    client: {
      voiceRelay: { enabled: true, config: { relay_enabled: true } }
    }
  }));

  assert.equal(blocked, true);
  assert.equal(spoken.length, 1);
  assert.match(blockedReplies[0], /Voice relay đang bật/);
});
