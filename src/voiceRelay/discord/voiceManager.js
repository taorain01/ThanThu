const { EventEmitter } = require('node:events');
const { ChannelType, PermissionsBitField } = require('discord.js');
const {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');

class VoiceRelayVoiceManager extends EventEmitter {
  constructor(client, env, relayState, supabaseConfig, logger) {
    super();
    this.client = client;
    this.env = env;
    this.relayState = relayState;
    this.supabaseConfig = supabaseConfig;
    this.logger = logger;
    this.config = null;
    this.connection = null;
    this.rejoinTimer = null;
  }

  updateConfig(config) {
    this.config = config;
    this.relayState.update({ relayEnabled: config.relay_enabled === true });
  }

  async ensureConnection() {
    if (!this.config?.auto_join) return null;
    let channelId = this.config.voice_channel_id;
    if (!channelId && this.config.auto_create_channel) {
      channelId = await this.createRelayChannel();
    }
    if (!channelId) return null;
    return this.joinChannel(channelId);
  }

  async joinChannel(channelId, options = {}) {
    const guild = await this.resolveGuild();
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!isVoiceChannel(channel)) throw new Error(`Không tìm thấy kênh voice ${channelId}`);

    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (me) {
      const perms = channel.permissionsFor(me);
      if (perms && (!perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak))) {
        throw new Error(`Bot thiếu quyền Connect/Speak ở kênh ${channel.name}`);
      }
    }

    const existing = getVoiceConnection(guild.id);
    if (existing && existing.joinConfig.channelId === channel.id) {
      this.connection = existing;
      this.emit('connection', existing, guild);
      this.relayState.update({
        voiceChannelId: channel.id,
        voiceChannelName: channel.name,
        lastError: null
      });
      return existing;
    }
    if (existing) existing.destroy();

    const connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: channel.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (_) {
        connection.destroy();
        this.scheduleRejoin();
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    this.connection = connection;
    this.relayState.update({
      voiceChannelId: channel.id,
      voiceChannelName: channel.name,
      lastError: null
    });
    if (options.persist !== false) await this.supabaseConfig.patchConfig({ voice_channel_id: channel.id });
    this.emit('connection', connection, guild);
    this.logger.info(`Đã vào kênh voice ${channel.name}`);
    return connection;
  }

  async leave() {
    const guild = await this.resolveGuild();
    const connection = getVoiceConnection(guild.id) || this.connection;
    if (connection) connection.destroy();
    this.connection = null;
    this.relayState.update({ voiceChannelId: null, voiceChannelName: null, activeSpeakers: [] });
  }

  scheduleRejoin() {
    if (this.rejoinTimer || !this.config?.auto_join) return;
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      this.ensureConnection().catch((error) => this.reportError(error));
    }, 5000);
  }

  async createRelayChannel() {
    const guild = await this.resolveGuild();
    const anchorId = this.config.create_anchor_channel_id;
    const anchor = anchorId ? await guild.channels.fetch(anchorId).catch(() => null) : null;
    const parent = anchor?.parent || null;
    const name = this.config.created_channel_name || (this.env.botId === 1 ? 'Đại Ngỗng' : 'Tiểu Ngỗng');
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: parent?.id || undefined,
      reason: 'Voice relay auto-create channel'
    });
    if (anchor && Number.isFinite(anchor.position)) {
      const pos = this.config.create_position === 'above' ? anchor.position : anchor.position + 1;
      await channel.setPosition(pos).catch(() => null);
    }
    await this.supabaseConfig.patchConfig({ voice_channel_id: channel.id });
    this.logger.info(`Đã tự tạo kênh voice ${channel.name}`);
    return channel.id;
  }

  async resolveGuild() {
    const guild = this.client.guilds.cache.get(this.env.guildId)
      || await this.client.guilds.fetch(this.env.guildId).catch(() => null);
    if (!guild) throw new Error(`Bot không ở guild ${this.env.guildId}`);
    return guild;
  }

  reportError(error) {
    this.logger.warn('Voice manager lỗi', error.message);
    this.relayState.update({ lastError: error.message });
  }
}

function isVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

module.exports = { VoiceRelayVoiceManager, isVoiceChannel };
