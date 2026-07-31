'use strict';

const fs = require('node:fs');
const path = require('node:path');

function redact(_key, value) {
  if (typeof _key === 'string' && /(token|authorization|secret|password)/i.test(_key)) {
    return '[REDACTED]';
  }
  return value;
}

function createLogger(logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  function write(level, message, details) {
    const suffix = details === undefined ? '' : ` ${JSON.stringify(details, redact)}`;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`;
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](line);
  }

  return {
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
  };
}

module.exports = {
  createLogger,
};
