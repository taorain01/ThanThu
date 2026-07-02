const { ChannelType } = require('discord.js');

class VoiceRelayGuildSync {
  constructor(client, env, supabaseConfig, logger) {
    this.client = client;
    this.env = env;
    this.supabaseConfig = supabaseConfig;
    this.logger = logger;
    this.timer = null;
  }

  start() {
    this.sync().catch((error) => this.logger.warn('Đồng bộ guild meta lỗi', error.message));
    this.timer = setInterval(() => {
      this.sync().catch((error) => this.logger.warn('Đồng bộ guild meta lỗi', error.message));
    }, 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sync() {
    const guild = this.client.guilds.cache.get(this.env.guildId)
      || await this.client.guilds.fetch(this.env.guildId).catch(() => null);
    if (!guild) return;

    await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);

    const voiceChannels = [...guild.channels.cache.values()]
      .filter((channel) => channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
      .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.parent ? `${channel.parent.name} / ${channel.name}` : channel.name
      }));

    const roles = [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id && !role.managed)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .map((role) => ({ id: role.id, name: role.name }));

    const { error } = await this.supabaseConfig.getClient()
      .from('voice_relay_guild_meta')
      .upsert({
        guild_id: this.env.guildId,
        voice_channels: voiceChannels,
        roles,
        updated_at: new Date().toISOString()
      }, { onConflict: 'guild_id' });
    if (error) throw error;
  }
}

module.exports = { VoiceRelayGuildSync };
