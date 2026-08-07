'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MODEL_PROFILE = '9router';
const MODEL_PROFILES = new Set([DEFAULT_MODEL_PROFILE, 'local', 'opus']);

class StateStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'StateStoreError';
  }
}

function createEmptyState() {
  return { version: 2, guilds: {} };
}

function validateGuildId(guildId) {
  return /^\d{17,20}$/.test(guildId);
}

function validateChannelEntry(guildId, channelId, entry) {
  if (entry && entry.modelProfile === undefined) {
    entry.modelProfile = DEFAULT_MODEL_PROFILE;
  }
  if (
    !/^\d{17,20}$/.test(channelId)
    || !entry
    || typeof entry.enabled !== 'boolean'
    || !Number.isSafeInteger(entry.sessionGeneration)
    || entry.sessionGeneration < 1
    || typeof entry.updatedAt !== 'string'
    || !MODEL_PROFILES.has(entry.modelProfile)
  ) {
    throw new StateStoreError(`Dữ liệu state của channel ${channelId} trong guild ${guildId} không hợp lệ.`);
  }
  // customModel là tùy chọn, nếu có phải là string không rỗng
  if (entry.customModel !== undefined && (typeof entry.customModel !== 'string' || !entry.customModel.trim())) {
    throw new StateStoreError(`customModel của channel ${channelId} không hợp lệ.`);
  }
  if (
    entry.appProfileFingerprint !== undefined
    && !/^[a-f0-9]{64}$/.test(entry.appProfileFingerprint)
  ) {
    throw new StateStoreError(`appProfileFingerprint của channel ${channelId} không hợp lệ.`);
  }
}

function validateStateV2(state) {
  if (!state || state.version !== 2 || typeof state.guilds !== 'object' || Array.isArray(state.guilds)) {
    throw new StateStoreError('data/state.json không đúng định dạng phiên bản 2.');
  }

  for (const [guildId, guild] of Object.entries(state.guilds)) {
    if (!validateGuildId(guildId) || !guild || typeof guild.channels !== 'object' || Array.isArray(guild.channels)) {
      throw new StateStoreError(`Dữ liệu state của guild ${guildId} không hợp lệ.`);
    }
    for (const [channelId, entry] of Object.entries(guild.channels)) {
      validateChannelEntry(guildId, channelId, entry);
    }
  }

  return state;
}

function migrateStateV1(state) {
  if (!state || state.version !== 1 || typeof state.guilds !== 'object' || Array.isArray(state.guilds)) {
    throw new StateStoreError('data/state.json không đúng định dạng được hỗ trợ.');
  }

  const migrated = createEmptyState();
  for (const [guildId, entry] of Object.entries(state.guilds)) {
    const validChannel = entry
      && (entry.channelId === null || /^\d{17,20}$/.test(String(entry.channelId)));
    if (
      !validateGuildId(guildId)
      || !entry
      || !validChannel
      || !Number.isSafeInteger(entry.sessionGeneration)
      || entry.sessionGeneration < 1
      || typeof entry.updatedAt !== 'string'
    ) {
      throw new StateStoreError(`Dữ liệu state phiên bản 1 của guild ${guildId} không hợp lệ.`);
    }

    const channels = {};
    if (entry.channelId) {
      channels[entry.channelId] = {
        enabled: true,
        sessionGeneration: entry.sessionGeneration,
        modelProfile: DEFAULT_MODEL_PROFILE,
        updatedAt: entry.updatedAt,
      };
    }
    migrated.guilds[guildId] = { channels };
  }
  return migrated;
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
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1) {
        this.state = migrateStateV1(parsed);
        await this.save();
      } else {
        this.state = validateStateV2(parsed);
      }
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
    const guild = this.state.guilds[guildId];
    if (!guild) {
      return null;
    }
    return {
      channels: Object.fromEntries(
        Object.entries(guild.channels).map(([channelId, entry]) => [channelId, { ...entry }]),
      ),
    };
  }

  getChannel(guildId, channelId) {
    const entry = this.state.guilds[guildId]?.channels?.[channelId];
    return entry ? { channelId, ...entry } : null;
  }

  getActiveChannels(guildId) {
    const channels = this.state.guilds[guildId]?.channels || {};
    return Object.entries(channels)
      .filter(([, entry]) => entry.enabled)
      .map(([channelId, entry]) => ({ channelId, ...entry }))
      .sort((a, b) => a.channelId.localeCompare(b.channelId));
  }

  async bindChannel(guildId, channelId) {
    const guild = this.state.guilds[guildId] || { channels: {} };
    const previous = guild.channels[channelId];
    const created = !previous;
    const reactivated = Boolean(previous && !previous.enabled);
    guild.channels[channelId] = {
      enabled: true,
      sessionGeneration: previous?.sessionGeneration || 1,
      modelProfile: previous?.modelProfile || DEFAULT_MODEL_PROFILE,
      ...(previous?.customModel ? { customModel: previous.customModel } : {}),
      ...(previous?.appProfileFingerprint
        ? { appProfileFingerprint: previous.appProfileFingerprint }
        : {}),
      updatedAt: this.now().toISOString(),
    };
    this.state.guilds[guildId] = guild;
    await this.save();
    return {
      channelId,
      ...guild.channels[channelId],
      changed: created || reactivated,
      created,
      reactivated,
    };
  }

  async resetSession(guildId, channelId) {
    const previous = this.state.guilds[guildId]?.channels?.[channelId];
    if (!previous?.enabled) {
      throw new StateStoreError('Kênh hiện tại chưa bật OpenClaw.');
    }
    previous.sessionGeneration += 1;
    previous.updatedAt = this.now().toISOString();
    await this.save();
    return { channelId, ...previous };
  }

  async setModelProfile(guildId, channelId, modelProfile) {
    const previous = this.state.guilds[guildId]?.channels?.[channelId];
    if (!previous?.enabled) {
      throw new StateStoreError('Kênh hiện tại chưa bật OpenClaw.');
    }
    if (!MODEL_PROFILES.has(modelProfile)) {
      throw new StateStoreError('Profile model không hợp lệ.');
    }
    previous.modelProfile = modelProfile;
    previous.updatedAt = this.now().toISOString();
    await this.save();
    return { channelId, ...previous };
  }

  async setCustomModel(guildId, channelId, customModel) {
    const previous = this.state.guilds[guildId]?.channels?.[channelId];
    if (!previous?.enabled) {
      throw new StateStoreError('Kênh hiện tại chưa bật OpenClaw.');
    }
    if (customModel && (typeof customModel !== 'string' || !customModel.trim())) {
      throw new StateStoreError('Tên model không hợp lệ.');
    }
    if (customModel) {
      previous.customModel = customModel.trim();
    } else {
      delete previous.customModel;
    }
    previous.updatedAt = this.now().toISOString();
    await this.save();
    return { channelId, ...previous };
  }

  // Áp dụng model/profile cho TOÀN BỘ kênh đang bật (mỗi kênh = một session
  // OpenClaw). Ghi một lần duy nhất thay vì save mỗi kênh. Kênh tắt không đổi.
  async setModelForAllChannels(guildId, { customModel = null, modelProfile = null } = {}) {
    const guild = this.state.guilds[guildId];
    if (!guild) {
      return [];
    }
    if (modelProfile !== null && !MODEL_PROFILES.has(modelProfile)) {
      throw new StateStoreError('Profile model không hợp lệ.');
    }
    if (customModel !== null && (typeof customModel !== 'string' || !customModel.trim())) {
      throw new StateStoreError('Tên model không hợp lệ.');
    }
    const updated = [];
    for (const [channelId, entry] of Object.entries(guild.channels)) {
      if (!entry.enabled) {
        continue;
      }
      if (customModel) {
        entry.customModel = customModel.trim();
      } else {
        delete entry.customModel;
      }
      if (modelProfile !== null) {
        entry.modelProfile = modelProfile;
      }
      entry.updatedAt = this.now().toISOString();
      updated.push(channelId);
    }
    if (updated.length > 0) {
      await this.save();
    }
    return updated;
  }

  async setAppProfileFingerprint(guildId, channelId, fingerprint) {
    const previous = this.state.guilds[guildId]?.channels?.[channelId];
    if (!previous?.enabled) {
      throw new StateStoreError('Kênh hiện tại chưa bật OpenClaw.');
    }
    if (fingerprint !== null && !/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) {
      throw new StateStoreError('Fingerprint profile app không hợp lệ.');
    }
    if (fingerprint) {
      previous.appProfileFingerprint = fingerprint;
    } else {
      delete previous.appProfileFingerprint;
    }
    previous.updatedAt = this.now().toISOString();
    await this.save();
    return { channelId, ...previous };
  }

  async unbind(guildId, channelId) {
    const guild = this.state.guilds[guildId] || { channels: {} };
    const previous = guild.channels[channelId];
    guild.channels[channelId] = {
      enabled: false,
      sessionGeneration: (previous?.sessionGeneration || 0) + 1,
      modelProfile: previous?.modelProfile || DEFAULT_MODEL_PROFILE,
      ...(previous?.customModel ? { customModel: previous.customModel } : {}),
      ...(previous?.appProfileFingerprint
        ? { appProfileFingerprint: previous.appProfileFingerprint }
        : {}),
      updatedAt: this.now().toISOString(),
    };
    this.state.guilds[guildId] = guild;
    await this.save();
    return { channelId, ...guild.channels[channelId] };
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
