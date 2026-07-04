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
    if (!isVoiceChannel(channel)) {
      throw new Error(`Không thấy kênh voice ${channelId} (kênh đã bị xoá hoặc bot thiếu quyền View Channel)`);
    }

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
        channelMemberCount: countHumanMembers(channel),
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
      channelMemberCount: countHumanMembers(channel),
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
    this.relayState.update({ voiceChannelId: null, voiceChannelName: null, channelMemberCount: 0, activeSpeakers: [] });
  }

  scheduleRejoin() {
    if (this.rejoinTimer || !this.config?.auto_join) return;
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      this.ensureConnection().catch((error) => {
        this.reportError(error);
        this.scheduleRejoin();
      });
    }, 5000);
  }

  async createRelayChannel() {
    const guild = await this.resolveGuild();
    const anchorId = this.config.create_anchor_channel_id;
    const anchor = anchorId ? await guild.channels.fetch(anchorId).catch(() => null) : null;
    const parent = anchor?.parent || null;
    const name = this.config.created_channel_name || (this.env.botId === 1 ? 'Đại Ngỗng' : this.env.botId === 2 ? 'Tiểu Ngỗng' : 'Chiến Ngỗng');
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
    await this.markManagedChannel(channel.id).catch((error) => this.logger.warn('Không đánh dấu được kênh relay tự tạo', error.message));
    this.logger.info(`Đã tự tạo kênh voice ${channel.name}`);
    return channel.id;
  }

  async markManagedChannel(channelId, ownerBotId = this.env.botId) {
    const { error } = await this.supabaseConfig.getClient()
      .from('voice_relay_managed_channels')
      .upsert({
        guild_id: this.env.guildId,
        channel_id: String(channelId),
        owner_bot_id: Number(ownerBotId),
        created_at: new Date().toISOString()
      }, { onConflict: 'guild_id,channel_id' });
    if (error) throw error;
  }

  async isManagedChannel(channelId) {
    if (!channelId) return false;
    const { data, error } = await this.supabaseConfig.getClient()
      .from('voice_relay_managed_channels')
      .select('channel_id')
      .eq('guild_id', this.env.guildId)
      .eq('channel_id', String(channelId))
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async deleteManagedChannel(channelId, { force = false } = {}) {
    if (!channelId || !(await this.isManagedChannel(channelId))) return false;
    const guild = await this.resolveGuild();
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      await this.removeManagedChannel(channelId);
      return false;
    }
    // KHÔNG bao giờ xoá phòng còn member nào (kể cả bot) để tránh làm bot relay bị kéo ra khi relay còn bật.
    if ((channel.members?.size || 0) > 0) return false;
    await channel.delete('Voice relay managed channel cleanup');
    await this.removeManagedChannel(channelId);
    return true;
  }

  async listManagedChannels() {
    const { data, error } = await this.supabaseConfig.getClient()
      .from('voice_relay_managed_channels')
      .select('channel_id,owner_bot_id')
      .eq('guild_id', this.env.guildId);
    if (error) throw error;
    return data || [];
  }

  // Quét và xoá các phòng managed mồ côi: không còn ai (kể cả bot) trong đó.
  // An toàn: phòng đang có bot ngồi chờ (>=1 thành viên) hoặc còn người sẽ KHÔNG bị xoá.
  async sweepOrphanManagedChannels() {
    if (this.config?.relay_enabled === true || this.config?.auto_join === true) return 0;
    const rows = await this.listManagedChannels().catch(() => []);
    if (!rows.length) return 0;
    const guild = await this.resolveGuild();
    let removed = 0;
    for (const row of rows) {
      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
      if (!channel) {
        await this.removeManagedChannel(row.channel_id);
        continue;
      }
      const totalMembers = channel.members?.size || 0;
      if (totalMembers === 0) {
        await channel.delete('Voice relay sweep phòng trống mồ côi').catch(() => null);
        await this.removeManagedChannel(row.channel_id);
        removed += 1;
      }
    }
    if (removed > 0) this.logger.info(`Đã dọn ${removed} phòng relay trống mồ côi`);
    return removed;
  }

  // Tự nhận diện lại kênh: tìm phòng managed đã có của bot (theo tên) để tái dùng thay vì tạo mới.
  async findManagedChannelForBot(ownerBotId, name) {
    const rows = await this.listManagedChannels().catch(() => []);
    const guild = await this.resolveGuild();
    let fallback = null;
    for (const row of rows) {
      if (Number(row.owner_bot_id) !== Number(ownerBotId)) continue;
      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
      if (!channel) {
        await this.removeManagedChannel(row.channel_id);
        continue;
      }
      if (name && channel.name === name) return channel; // khớp tên → ưu tiên tái dùng
      if (!fallback) fallback = channel;
    }
    return fallback;
  }

  async removeManagedChannel(channelId) {
    await this.supabaseConfig.getClient()
      .from('voice_relay_managed_channels')
      .delete()
      .eq('guild_id', this.env.guildId)
      .eq('channel_id', String(channelId));
  }

  async stopAndDeleteManaged({ force = false } = {}) {
    const channelId = this.config?.voice_channel_id || this.relayState.snapshot().voiceChannelId;
    await this.leave();
    if (channelId) await this.deleteManagedChannel(channelId, { force });
  }

  getCurrentHumanCount() {
    const channelId = this.connection?.joinConfig?.channelId || this.relayState.snapshot().voiceChannelId;
    const guild = this.client.guilds.cache.get(this.env.guildId);
    const channel = channelId ? guild?.channels.cache.get(channelId) : null;
    return countHumanMembers(channel);
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

function countHumanMembers(channel) {
  return channel?.members?.filter((member) => !member.user?.bot).size || 0;
}

function isVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

module.exports = { VoiceRelayVoiceManager, isVoiceChannel, countHumanMembers };
