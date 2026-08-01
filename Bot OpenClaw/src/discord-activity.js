'use strict';

const { sanitizeActivityText, sanitizeInline } = require('./session-activity');

function isRootTranscriptFinal(event) {
  return Boolean(
    event?.origin === 'transcript'
    && event.isRoot
    && event.kind === 'assistant'
    && event.final
  );
}

function isAuxiliarySessionActivity(event) {
  return Boolean(
    event?.origin === 'transcript'
    && !event.isRoot
    && event.sessionKey
  );
}

function sessionActivityRecord(event) {
  if (!isAuxiliarySessionActivity(event)) {
    return null;
  }
  const text = sanitizeActivityText(event.notificationText || event.text, 4000);
  if (!text) {
    return null;
  }
  return {
    kind: String(event.kind || 'activity'),
    text,
    final: event.final === true,
    label: sanitizeInline(event.sourceLabel || ''),
  };
}

module.exports = {
  isAuxiliarySessionActivity,
  isRootTranscriptFinal,
  sessionActivityRecord,
};
