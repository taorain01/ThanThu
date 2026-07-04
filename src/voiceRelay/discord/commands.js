const { ChannelType, PermissionFlagsBits } = require('discord.js');

async function handleVoiceRelayMessage(message, client) {
  const runtime = client.voiceRelay;
  if (!runtime?.enabled) return false;
  if (message.author?.bot || !message.guild) return false;
  if (runtime.env.guildId && message.guild.id !== runtime.env.guildId) return false;

  const match = matchCommandPrefix(message.content, runtime.getCommandPrefixes());
  if (!match) return false;

  const parts = match.rest.trim().split(/\s+/).filter(Boolean);
  const subcommand = (parts.shift() || 'status').toLowerCase();

  if (!canControl(message, runtime.env)) {
    await message.reply('Bạn không có quyền điều khiển voice relay.');
    return true;
  }

  try {
    if (['help', 'h', '?'].includes(subcommand)) return sendHelp(message, match.prefix);
    if (subcommand === 'status') return sendStatus(message, runtime);
    if (subcommand === 'join') return join(message, runtime, parts);
    if (subcommand === 'leave') {
      await runtime.voiceManager.leave();
      await runtime.patchConfig({ auto_join: false });
      await message.react('✅').catch(() => null);
      return true;
    }
    if (subcommand === 'start') {
      await runtime.patchConfig({ relay_enabled: true, auto_join: true });
      await runtime.voiceManager.ensureConnection();
      await message.react('✅').catch(() => null);
      return true;
    }
    if (subcommand === 'stop') {
      await runtime.patchConfig({ relay_enabled: false, auto_join: false });
      await message.react('✅').catch(() => null);
      return true;
    }
    await sendHelp(message, match.prefix);
  } catch (error) {
    runtime.logger.warn(`Lệnh relay ${subcommand} lỗi`, error.message);
    await message.reply(`Lỗi voice relay: ${error.message}`).catch(() => null);
  }
  return true;
}

function matchCommandPrefix(content, prefixes) {
  const text = String(content || '');
  const sorted = [...prefixes].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (text === prefix) return { prefix, rest: '' };
    if (text.startsWith(`${prefix} `)) return { prefix, rest: text.slice(prefix.length) };
  }
  return null;
}

function canControl(message, env) {
  if (!env.requireAdminCommands) return true;
  if (env.commandAdminIds.includes(String(message.author.id))) return true;
  const permissions = message.member?.permissions;
  return Boolean(
    permissions?.has(PermissionFlagsBits.Administrator)
    || permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

async function join(message, runtime, args) {
  const channel = await resolveVoiceChannel(message, args);
  if (!channel) {
    await message.reply('Hãy vào voice trước, hoặc dùng lệnh kèm ID kênh voice.');
    return true;
  }
  await runtime.patchConfig({ voice_channel_id: channel.id, auto_join: true });
  await runtime.voiceManager.joinChannel(channel.id);
  await message.react('✅').catch(() => null);
  return true;
}

async function resolveVoiceChannel(message, args) {
  const requestedId = args[0]?.match(/\d{15,25}/)?.[0] || '';
  if (requestedId) {
    const channel = await message.guild.channels.fetch(requestedId).catch(() => null);
    if (isVoice(channel)) return channel;
  }
  return isVoice(message.member?.voice?.channel) ? message.member.voice.channel : null;
}

function isVoice(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

async function sendStatus(message, runtime) {
  const s = runtime.relayState.snapshot();
  const lines = [
    `Voice relay ${runtime.env.botName}:`,
    `- Kênh: ${s.voiceChannelName || s.voiceChannelId || 'chưa vào'}`,
    `- Relay: ${s.relayEnabled ? 'bật' : 'tắt'}`,
    `- Link 2 bot: ${s.linkConnected ? 'kết nối' : 'mất'}`,
    `- Người đang nói: ${s.activeSpeakers.length}`,
    s.lastError ? `- Lỗi gần nhất: ${s.lastError}` : ''
  ].filter(Boolean);
  await message.reply(lines.join('\n'));
  return true;
}

async function sendHelp(message, prefix) {
  await message.reply([
    `Lệnh voice relay (${prefix}):`,
    `- \`${prefix} join [voiceChannelId]\``,
    `- \`${prefix} leave\``,
    `- \`${prefix} start\``,
    `- \`${prefix} stop\``,
    `- \`${prefix} status\``
  ].join('\n'));
  return true;
}

module.exports = {
  handleVoiceRelayMessage,
  matchCommandPrefix
};
