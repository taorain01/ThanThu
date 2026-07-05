class VoiceRelayLogger {
  constructor(env = {}) {
    this.env = env;
    this.secrets = [
      env.linkSecret,
      env.supabaseServiceKey,
      process.env.token,
      process.env.DISCORD_TOKEN,
      process.env.BOT2_TOKEN,
      process.env.TIEU_NGONG_TOKEN
    ].filter(Boolean).map(String);
  }

  mask(value) {
    let text = typeof value === 'string' ? value : safeJson(value);
    for (const secret of this.secrets) {
      if (secret && secret.length >= 6) text = text.split(secret).join('[secret]');
    }
    return text;
  }

  line(level, message, meta) {
    if (level === 'debug' && this.env.verboseLogs !== true) return;
    const stamp = new Date().toISOString();
    const bot = this.env.botId ? `Bot${this.env.botId}` : 'Bot?';
    const suffix = meta === undefined ? '' : ` ${this.mask(meta)}`;
    const text = `[${stamp}] [VoiceRelay:${bot}] ${this.mask(message)}${suffix}`;
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
  }

  info(message, meta) { this.line('info', message, meta); }
  debug(message, meta) { this.line('debug', message, meta); }
  warn(message, meta) { this.line('warn', message, meta); }
  error(message, meta) { this.line('error', message, meta); }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

module.exports = { VoiceRelayLogger };
