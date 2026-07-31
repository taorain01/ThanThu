'use strict';

const VALID_ACTIONS = new Set(['status', 'reset', 'stop', 'off']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCommand(content, prefix) {
  const pattern = new RegExp(
    `^${escapeRegExp(prefix)}\\s*openclaw(?:\\s+([^\\s]+))?\\s*$`,
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
  return VALID_ACTIONS.has(action) ? { action } : { action: 'help' };
}

module.exports = {
  parseCommand,
};
