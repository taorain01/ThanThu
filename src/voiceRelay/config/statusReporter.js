class StatusReporter {
  constructor(env, supabaseConfig, relayState, logger) {
    this.env = env;
    this.supabaseConfig = supabaseConfig;
    this.relayState = relayState;
    this.logger = logger;
    this.statusTimer = null;
    this.commandTimer = null;
    this.pendingWrite = null;
    this.actionHandler = null;
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
      const row = {
        guild_id: this.env.guildId,
        bot_id: this.env.botId,
        discord_connected: s.discordConnected === true,
        voice_channel_id: s.voiceChannelId || null,
        voice_channel_name: s.voiceChannelName || null,
        relay_enabled: s.relayEnabled === true,
        link_connected: s.linkConnected === true,
        last_error: s.lastError || null,
        heartbeat_at: new Date().toISOString()
      };
      const { error } = await this.supabaseConfig.getClient()
        .from('voice_relay_status')
        .upsert(row, { onConflict: 'guild_id,bot_id' });
      if (error) throw error;
    } catch (error) {
      this.logger.warn('Không ghi được trạng thái voice relay', error.message);
    }
  }

  async pollAction() {
    try {
      const cfg = await this.supabaseConfig.loadConfig({ createIfMissing: true });
      const action = cfg.pending_action;
      if (!['rejoin', 'leave'].includes(action)) return;
      await this.supabaseConfig.clearPendingAction();
      if (this.actionHandler) await this.actionHandler(action);
    } catch (error) {
      this.logger.warn('Không đọc được pending_action voice relay', error.message);
    }
  }
}

module.exports = { StatusReporter };
