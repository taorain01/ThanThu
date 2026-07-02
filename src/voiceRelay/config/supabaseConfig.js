const { createClient } = require('@supabase/supabase-js');

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function normalizeConfig(row, env) {
  const fallbackPrefix = env.commandPrefix || (env.botId === 1 ? '?relay' : '!relay');
  return {
    guild_id: env.guildId,
    bot_id: env.botId,
    voice_channel_id: row?.voice_channel_id || env.defaultVoiceChannelId || '',
    mode: row?.mode === 'broadcast' ? 'broadcast' : 'bridge',
    caller_role_ids: asArray(row?.caller_role_ids),
    blocked_role_ids: asArray(row?.blocked_role_ids),
    caller_user_ids: asArray(row?.caller_user_ids),
    muted_user_ids: asArray(row?.muted_user_ids),
    relay_targets: asArray(row?.relay_targets),
    speaker_priority: row?.speaker_priority === 'priority' ? 'priority' : 'mix',
    priority_role_ids: asArray(row?.priority_role_ids),
    relay_enabled: row?.relay_enabled === true,
    auto_join: row?.auto_join !== false,
    command_prefix: row?.command_prefix || fallbackPrefix,
    pending_action: row?.pending_action || null,
    auto_create_channel: row?.auto_create_channel === true,
    created_channel_name: row?.created_channel_name || (env.botId === 1 ? 'Đại Ngỗng' : env.botId === 2 ? 'Tiểu Ngỗng' : 'Chiến Ngỗng'),
    create_position: row?.create_position === 'above' ? 'above' : 'below',
    create_anchor_channel_id: row?.create_anchor_channel_id || '',
    updated_at: row?.updated_at || null
  };
}

function defaultRow(env) {
  return {
    guild_id: env.guildId,
    bot_id: env.botId,
    voice_channel_id: env.defaultVoiceChannelId || null,
    mode: 'bridge',
    caller_role_ids: [],
    blocked_role_ids: [],
    caller_user_ids: [],
    muted_user_ids: [],
    relay_targets: [],
    speaker_priority: 'mix',
    priority_role_ids: [],
    relay_enabled: false,
    auto_join: true,
    command_prefix: env.commandPrefix,
    auto_create_channel: false,
    created_channel_name: env.botId === 1 ? 'Đại Ngỗng' : env.botId === 2 ? 'Tiểu Ngỗng' : 'Chiến Ngỗng',
    create_position: 'below',
    create_anchor_channel_id: null,
    updated_at: new Date().toISOString()
  };
}

class SupabaseConfig {
  constructor(env, logger) {
    this.env = env;
    this.logger = logger;
    this.client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    this.current = null;
    this.pollTimer = null;
    this.channel = null;
  }

  getClient() {
    return this.client;
  }

  async loadConfig({ createIfMissing = true } = {}) {
    const { data, error } = await this.client
      .from('voice_relay_config')
      .select('*')
      .eq('guild_id', this.env.guildId)
      .eq('bot_id', this.env.botId)
      .maybeSingle();

    if (error) throw error;
    if (!data && createIfMissing) {
      const { data: inserted, error: insertError } = await this.client
        .from('voice_relay_config')
        .upsert(defaultRow(this.env), { onConflict: 'guild_id,bot_id' })
        .select('*')
        .maybeSingle();
      if (insertError) throw insertError;
      this.current = normalizeConfig(inserted, this.env);
      return this.current;
    }

    this.current = normalizeConfig(data, this.env);
    return this.current;
  }

  async patchConfig(patch) {
    const row = {
      guild_id: this.env.guildId,
      bot_id: this.env.botId,
      ...patch,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await this.client
      .from('voice_relay_config')
      .upsert(row, { onConflict: 'guild_id,bot_id' })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    this.current = normalizeConfig(data, this.env);
    return this.current;
  }

  async clearPendingAction() {
    return this.patchConfig({ pending_action: null });
  }

  subscribe(onChange) {
    const apply = (row) => {
      if (!row || String(row.guild_id) !== String(this.env.guildId)) return;
      if (Number(row.bot_id) !== Number(this.env.botId)) return;
      const next = normalizeConfig(row, this.env);
      this.current = next;
      onChange(next);
    };

    try {
      this.channel = this.client
        .channel(`voice_relay_config_${this.env.guildId}_${this.env.botId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'voice_relay_config',
          filter: `bot_id=eq.${this.env.botId}`
        }, (payload) => apply(payload.new))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') this.logger.info('Đã subscribe cấu hình Supabase realtime');
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.startPolling(onChange);
        });
    } catch (error) {
      this.logger.warn('Không subscribe được Supabase realtime, chuyển sang polling', error.message);
      this.startPolling(onChange);
    }

    this.startPolling(onChange);
    return () => this.stop();
  }

  startPolling(onChange) {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      try {
        const prev = JSON.stringify(this.current || {});
        const next = await this.loadConfig({ createIfMissing: true });
        if (JSON.stringify(next) !== prev) onChange(next);
      } catch (error) {
        this.logger.warn('Polling cấu hình Supabase lỗi', error.message);
      }
    }, this.env.configPollIntervalMs);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.channel) this.client.removeChannel(this.channel).catch(() => null);
    this.channel = null;
  }
}

module.exports = {
  SupabaseConfig,
  normalizeConfig
};
