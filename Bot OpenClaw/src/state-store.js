'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class StateStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'StateStoreError';
  }
}

function createEmptyState() {
  return { version: 1, guilds: {} };
}

function validateState(state) {
  if (!state || state.version !== 1 || typeof state.guilds !== 'object' || Array.isArray(state.guilds)) {
    throw new StateStoreError('data/state.json không đúng định dạng phiên bản 1.');
  }

  for (const [guildId, entry] of Object.entries(state.guilds)) {
    const validChannel = entry
      && (entry.channelId === null || /^\d{17,20}$/.test(String(entry.channelId)));
    if (
      !/^\d{17,20}$/.test(guildId)
      || !entry
      || !validChannel
      || !Number.isSafeInteger(entry.sessionGeneration)
      || entry.sessionGeneration < 1
      || typeof entry.updatedAt !== 'string'
    ) {
      throw new StateStoreError(`Dữ liệu state của guild ${guildId} không hợp lệ.`);
    }
  }

  return state;
}

class StateStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.now = options.now || (() => new Date());
    this.state = createEmptyState();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.state = validateState(JSON.parse(raw));
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.state = createEmptyState();
        return this.state;
      }
      if (error instanceof StateStoreError) {
        throw error;
      }
      throw new StateStoreError('Không thể đọc data/state.json; file được giữ nguyên để kiểm tra.', error);
    }
    return this.state;
  }

  getGuild(guildId) {
    const entry = this.state.guilds[guildId];
    return entry ? { ...entry } : null;
  }

  async bindChannel(guildId, channelId) {
    const previous = this.state.guilds[guildId];
    const changed = !previous || previous.channelId !== channelId;
    const sessionGeneration = changed
      ? (previous?.sessionGeneration || 0) + 1
      : previous.sessionGeneration;

    this.state.guilds[guildId] = {
      channelId,
      sessionGeneration,
      updatedAt: this.now().toISOString(),
    };
    await this.save();
    return { ...this.state.guilds[guildId], changed };
  }

  async resetSession(guildId) {
    const previous = this.state.guilds[guildId];
    if (!previous?.channelId) {
      throw new StateStoreError('Server chưa chọn kênh OpenClaw.');
    }
    previous.sessionGeneration += 1;
    previous.updatedAt = this.now().toISOString();
    await this.save();
    return { ...previous };
  }

  async unbind(guildId) {
    const previous = this.state.guilds[guildId];
    const sessionGeneration = (previous?.sessionGeneration || 0) + 1;
    this.state.guilds[guildId] = {
      channelId: null,
      sessionGeneration,
      updatedAt: this.now().toISOString(),
    };
    await this.save();
    return { ...this.state.guilds[guildId] };
  }

  async save() {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw new StateStoreError('Không thể lưu data/state.json.', error);
    }
  }
}

module.exports = {
  StateStore,
  StateStoreError,
};
