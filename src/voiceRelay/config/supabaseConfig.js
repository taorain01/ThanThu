const { createClient } = require('@supabase/supabase-js');

const OPTIONAL_CONFIG_COLUMNS = new Set([
  'caller_user_ids',
  'muted_user_ids',
  'jitter_buffer_ms',
  'speaker_release_ms',
  'auto_create_channel',
  'created_channel_name',
  'create_position',
  'create_anchor_channel_id',
  'anchor_original_name'
]);

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

function normalizeJitterMs(value, env) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.min(2000, Math.max(60, Math.round(n)));
  const fromEnv = Number(env?.jitterBufferMs);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 400;
}

function normalizeReleaseMs(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.min(3000, Math.max(100, Math.round(n)));
  return 500;
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
    jitter_buffer_ms: normalizeJitterMs(row?.jitter_buffer_ms, env),
    speaker_release_ms: normalizeReleaseMs(row?.speaker_release_ms),
    pending_action: row?.pending_action || null,
    auto_create_channel: row?.auto_create_channel === true,
    created_channel_name: row?.created_channel_name || (env.botId === 1 ? 'Đại Ngỗng' : env.botId === 2 ? 'Tiểu Ngỗng' : 'Chiến Ngỗng'),
    create_position: row?.create_position === 'above' ? 'above' : 'below',
    create_anchor_channel_id: row?.create_anchor_channel_id || '',
    anchor_original_name: row?.anchor_original_name || null,
    updated_at: row?.updated_at || null
  };
}

function hasCallerPolicy(config) {
  return Boolean((config?.caller_role_ids || []).length || (config?.caller_user_ids || []).length);
}

function applyPolicyFromRow(config, row) {
  if (!row || typeof row !== 'object') return config;
  return {
    ...config,
    caller_role_ids: asArray(row.caller_role_ids),
    blocked_role_ids: asArray(row.blocked_role_ids),
    caller_user_ids: asArray(row.caller_user_ids),
    muted_user_ids: asArray(row.muted_user_ids),
    speaker_priority: row.speaker_priority === 'priority' ? 'priority' : 'mix',
    priority_role_ids: asArray(row.priority_role_ids)
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
    jitter_buffer_ms: normalizeJitterMs(null, env),
    speaker_release_ms: 500,
    auto_create_channel: false,
    created_channel_name: env.botId === 1 ? 'Đại Ngỗng' : env.botId === 2 ? 'Tiểu Ngỗng' : 'Chiến Ngỗng',
    create_position: 'below',
    create_anchor_channel_id: null,
    updated_at: new Date().toISOString()
  };
}

function missingVoiceConfigColumn(error) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  if (!/voice_relay_config/i.test(text) || !/schema cache/i.test(text)) return null;

  const match = text.match(/'([^']+)'\s+column\s+of\s+'voice_relay_config'/i)
    || text.match(/column\s+'([^']+)'/i);
  const column = match?.[1] || '';
  return OPTIONAL_CONFIG_COLUMNS.has(column) ? column : null;
}

function rowHasColumn(row, column) {
  return row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, column);
}

function payloadHasColumn(payload, column) {
  return Array.isArray(payload)
    ? payload.some((row) => rowHasColumn(row, column))
    : rowHasColumn(payload, column);
}

function omitColumn(row, column) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next[column];
  return next;
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
    this.warnedMissingConfigColumns = new Set();
    this.warnedInheritedPolicy = false;
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
      const { data: inserted } = await this.upsertConfig(defaultRow(this.env), { maybeSingle: true });
      this.current = await this.applyInheritedPolicy(normalizeConfig(inserted, this.env));
      return this.current;
    }

    this.current = await this.applyInheritedPolicy(normalizeConfig(data, this.env));
    return this.current;
  }

  async patchConfig(patch) {
    const row = {
      guild_id: this.env.guildId,
      bot_id: this.env.botId,
      ...patch,
      updated_at: new Date().toISOString()
    };
    const { data } = await this.upsertConfig(row, { maybeSingle: true });
    this.current = await this.applyInheritedPolicy(normalizeConfig(data, this.env));
    return this.current;
  }

  async applyInheritedPolicy(config) {
    if (this.env.botId === 1 || hasCallerPolicy(config) || config.relay_enabled !== true) return config;

    const { data, error } = await this.client
      .from('voice_relay_config')
      .select('*')
      .eq('guild_id', this.env.guildId)
      .eq('bot_id', 1)
      .maybeSingle();
    if (error || !data) return config;

    const inherited = applyPolicyFromRow(config, data);
    if (hasCallerPolicy(inherited)) {
      if (!this.warnedInheritedPolicy) {
        this.warnedInheritedPolicy = true;
        this.logger.info('Bot phụ dùng tạm policy người nói từ Bot 1 vì config hiện tại chưa có caller role/user.');
      }
    }
    return inherited;
  }

  async upsertConfig(payload, options = {}) {
    const { select = '*', maybeSingle = false } = options;
    let currentPayload = payload;
    const omittedColumns = [];

    while (true) {
      let query = this.client
        .from('voice_relay_config')
        .upsert(currentPayload, { onConflict: 'guild_id,bot_id' });
      if (select) query = query.select(select);

      const result = maybeSingle ? await query.maybeSingle() : await query;
      if (!result.error) return { data: result.data, omittedColumns };

      const column = missingVoiceConfigColumn(result.error);
      if (!column || omittedColumns.includes(column) || !payloadHasColumn(currentPayload, column)) {
        throw result.error;
      }

      if (!this.warnedMissingConfigColumns.has(column)) {
        this.warnedMissingConfigColumns.add(column);
        this.logger.warn(`Bảng voice_relay_config chưa có cột ${column}; tạm bỏ qua khi ghi. Chạy lại db/voice_relay_3bot.sql để bật đủ cấu hình.`);
      }

      currentPayload = Array.isArray(currentPayload)
        ? currentPayload.map((row) => omitColumn(row, column))
        : omitColumn(currentPayload, column);
      omittedColumns.push(column);
    }
  }

  async clearPendingAction() {
    return this.patchConfig({ pending_action: null });
  }

  subscribe(onChange) {
    const apply = async (row) => {
      if (!row || String(row.guild_id) !== String(this.env.guildId)) return;
      if (Number(row.bot_id) !== Number(this.env.botId)) return;
      const next = await this.applyInheritedPolicy(normalizeConfig(row, this.env));
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
        }, (payload) => apply(payload.new).catch((error) => {
          this.logger.warn('Áp dụng cấu hình realtime Supabase lỗi', error.message);
        }))
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
