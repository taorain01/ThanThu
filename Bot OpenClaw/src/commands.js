'use strict';

const VALID_ACTIONS = new Set(['status', 'jobs', 'reset', 'resume', 'resend', 'stop', 'off']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCommand(content, prefix) {
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
