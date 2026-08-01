'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class MessageCursorStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'MessageCursorStoreError';
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || ''));
}

function compareSnowflakes(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateState(state) {
  if (!state || state.version !== 1 || !state.channels || typeof state.channels !== 'object' || Array.isArray(state.channels)) {
    throw new MessageCursorStoreError('data/message-cursors.json không đúng định dạng phiên bản 1.');
  }
  for (const [channelId, entry] of Object.entries(state.channels)) {
    if (
      !validSnowflake(channelId)
      || !entry
      || !validSnowflake(entry.lastMessageId)
      || typeof entry.updatedAt !== 'string'
    ) {
      throw new MessageCursorStoreError(`Cursor của channel ${channelId} không hợp lệ.`);
    }
  }
  return state;
}

class MessageCursorStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.now = options.now || (() => new Date());
    this.state = { version: 1, channels: {} };
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      this.state = validateState(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.state = { version: 1, channels: {} };
        return clone(this.state);
      }
      if (error instanceof MessageCursorStoreError) {
        throw error;
      }
      throw new MessageCursorStoreError(
        'Không thể đọc data/message-cursors.json; file được giữ nguyên để kiểm tra.',
        error,
      );
    }
    return clone(this.state);
  }

  getChannel(channelId) {
    const entry = this.state.channels[String(channelId)];
    return entry ? clone(entry) : null;
  }

  async advance(channelId, messageId) {
    const normalizedChannelId = String(channelId);
    const normalizedMessageId = String(messageId);
    if (!validSnowflake(normalizedChannelId) || !validSnowflake(normalizedMessageId)) {
      throw new MessageCursorStoreError('Channel ID hoặc message ID không phải Discord snowflake hợp lệ.');
    }

    const operation = this.writeChain.catch(() => {}).then(async () => {
      const previous = this.state.channels[normalizedChannelId];
      if (previous && compareSnowflakes(previous.lastMessageId, normalizedMessageId) >= 0) {
        return clone(previous);
      }
      const entry = {
        lastMessageId: normalizedMessageId,
        updatedAt: this.now().toISOString(),
      };
      const previousState = clone(this.state);
      this.state.channels[normalizedChannelId] = entry;
      try {
        await this.saveNow();
      } catch (error) {
        this.state = previousState;
        throw error;
      }
      return clone(entry);
    });
    this.writeChain = operation;
    return operation;
  }

  async saveNow() {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw new MessageCursorStoreError('Không thể lưu data/message-cursors.json.', error);
    }
  }
}

module.exports = {
  MessageCursorStore,
  MessageCursorStoreError,
  compareSnowflakes,
  validSnowflake,
};
