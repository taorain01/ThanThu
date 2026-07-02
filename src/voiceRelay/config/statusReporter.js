class StatusReporter {
  constructor(env, supabaseConfig, relayState, logger, voiceManager = null) {
    this.env = env;
    this.supabaseConfig = supabaseConfig;
    this.relayState = relayState;
    this.logger = logger;
    this.voiceManager = voiceManager;
    this.statusTimer = null;
    this.commandTimer = null;
    this.pendingWrite = null;
    this.actionHandler = null;
    this.warnedMissingIdentityColumns = false;
  }

  start(actionHandler) {
    this.actionHandler = actionHandler;
    this.relayState.on('change', () => this.scheduleWrite());
    this.statusTimer = setInterval(() => this.writeStatus(), this.env.statusIntervalMs);
    this.commandTimer = setInterval(() => this.pollAction(), this.env.commandPollIntervalMs);
    this.scheduleWrite();
  }

  stop() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.commandTimer) clearInterval(this.commandTimer);
    if (this.pendingWrite) clearTimeout(this.pendingWrite);
    this.statusTimer = null;
    this.commandTimer = null;
    this.pendingWrite = null;
  }

  scheduleWrite() {
    if (this.pendingWrite) return;
    this.pendingWrite = setTimeout(() => {
      this.pendingWrite = null;
      this.writeStatus();
    }, 1000);
  }

  async writeStatus() {
    try {
      const s = this.relayState.snapshot();
      const channelMemberCount = this.voiceManager?.getCurrentHumanCount?.() ?? s.channelMemberCount ?? 0;
      const row = {
        guild_id: this.env.guildId,
        bot_id: this.env.botId,
        bot_username: s.botUsername || null,
        bot_avatar_url: s.botAvatarUrl || null,
        discord_connected: s.discordConnected === true,
        voice_channel_id: s.voiceChannelId || null,
        voice_channel_name: s.voiceChannelName || null,
        relay_enabled: s.relayEnabled === true,
        link_connected: s.linkConnected === true,
        channel_member_count: Number(channelMemberCount || 0),
        last_error: s.lastError || null,
        heartbeat_at: new Date().toISOString()
      };
      const { error } = await this.writeStatusRow(row);
      if (error) throw error;
    } catch (error) {
      this.logger.warn('Không ghi được trạng thái voice relay', error.message);
    }
  }

  async writeStatusRow(row) {
    const client = this.supabaseConfig.getClient();
    const result = await client
      .from('voice_relay_status')
      .upsert(row, { onConflict: 'guild_id,bot_id' });

    if (!result.error || !isMissingIdentityColumn(result.error)) return result;

    if (!this.warnedMissingIdentityColumns) {
      this.warnedMissingIdentityColumns = true;
      this.logger.warn('Bảng voice_relay_status chưa có cột avatar bot. Chạy lại db/voice_relay_3bot.sql để web hiện avatar thật.');
    }

    const fallback = { ...row };
    delete fallback.bot_username;
    delete fallback.bot_avatar_url;
    return client
      .from('voice_relay_status')
      .upsert(fallback, { onConflict: 'guild_id,bot_id' });
  }

  async pollAction() {
    try {
      const cfg = await this.supabaseConfig.loadConfig({ createIfMissing: true });
      const action = cfg.pending_action;
      if (!['rejoin', 'leave', 'quickSetup', 'stopLeave', 'stopDelete'].includes(action)) return;
      await this.supabaseConfig.clearPendingAction();
      if (this.actionHandler) await this.actionHandler(action);
    } catch (error) {
      this.logger.warn('Không đọc được pending_action voice relay', error.message);
    }
  }
}

function isMissingIdentityColumn(error) {
  const text = String(error?.message || error?.details || '');
  return /bot_username|bot_avatar_url/i.test(text);
}

module.exports = { StatusReporter };
