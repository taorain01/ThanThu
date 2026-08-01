'use strict';

const VALID_ACTIONS = new Set([
  'status',
  'system',
  'jobs',
  'model',
  'reset',
  'resume',
  'resend',
  'stop',
  'off',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCommand(content, prefix) {
  const systemPattern = new RegExp(
    `^${escapeRegExp(prefix)}\\s*s\\s*$`,
    'i',
  );
  if (systemPattern.test(String(content || '').trim())) {
    return { action: 'system' };
  }

  const shortPattern = new RegExp(
    `^${escapeRegExp(prefix)}\\s*o(?:\\s+(.+?))?\\s*$`,
    'i',
  );
  const shortMatch = String(content || '').trim().match(shortPattern);
  if (shortMatch) {
    const parts = String(shortMatch[1] || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return { action: 'status' };
    }

    const action = {
      status: 'status',
      s: 'stop',
      stop: 'stop',
      m: 'model',
      model: 'model',
    }[parts.shift().toLowerCase()];
    if (!action) {
      return null;
    }
    const args = parts;
    return args.length ? { action, args } : { action };
  }

  const pattern = new RegExp(
    `^${escapeRegExp(prefix)}\\s*openclaw(?:\\s+([^\\s]+))?(?:\\s+(.+?))?\\s*$`,
    'i',
  );
  const match = String(content || '').trim().match(pattern);
  if (!match) {
    return null;
  }

  if (!match[1]) {
    return { action: 'bind' };
  }

  const action = match[1].toLowerCase();
  if (!VALID_ACTIONS.has(action)) {
    return { action: 'help' };
  }
  const args = String(match[2] || '').trim().split(/\s+/).filter(Boolean);
  return args.length ? { action, args } : { action };
}

module.exports = {
  parseCommand,
};
