function roleIdsOf(member) {
  if (!member?.roles?.cache) return [];
  return [...member.roles.cache.keys()].map(String);
}

function evaluateSpeaker(member, config) {
  if (!member) return { allowed: false, reason: 'member_not_found' };
  if (member.user?.bot) return { allowed: false, reason: 'bot_user' };

  const memberId = String(member.id || member.user?.id || '');
  const mutedUsers = (config.muted_user_ids || []).map(String);
  if (memberId && mutedUsers.includes(memberId)) return { allowed: false, reason: 'muted_user' };

  const roles = new Set(roleIdsOf(member));
  const blocked = (config.blocked_role_ids || []).map(String);
  if (blocked.some((id) => roles.has(id))) return { allowed: false, reason: 'blocked_role' };

  const callers = (config.caller_role_ids || []).map(String);
  const callerUsers = (config.caller_user_ids || []).map(String);
  if (!callers.length && !callerUsers.length) return { allowed: false, reason: 'no_callers_configured' };
  if (!callerUsers.includes(memberId) && !callers.some((id) => roles.has(id))) {
    return { allowed: false, reason: 'missing_caller_permission' };
  }

  return { allowed: true, reason: 'allowed' };
}

function resolveTargets(config, botId, allBotIds = [1, 2, 3]) {
  const self = Number(botId);
  const validTargets = (targets) => (targets || [])
    .map((x) => Number(x))
    .filter((x, index, arr) => allBotIds.includes(x) && x !== self && arr.indexOf(x) === index);
  if (config.mode === 'broadcast') {
    return validTargets(config.relay_targets);
  }
  return validTargets(allBotIds);
}

function priorityIndex(roleIds, priorityRoleIds) {
  const roles = new Set((roleIds || []).map(String));
  const priorities = (priorityRoleIds || []).map(String);
  for (let i = 0; i < priorities.length; i += 1) {
    if (roles.has(priorities[i])) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

function pickActiveSpeakers(speakers, config) {
  const list = Array.isArray(speakers) ? speakers : [];
  if (config.speaker_priority !== 'priority') return list;
  if (!list.length) return [];

  let best = Number.MAX_SAFE_INTEGER;
  for (const speaker of list) {
    best = Math.min(best, priorityIndex(speaker.roleIds, config.priority_role_ids));
  }
  return list.filter((speaker) => priorityIndex(speaker.roleIds, config.priority_role_ids) === best);
}

module.exports = {
  evaluateSpeaker,
  pickActiveSpeakers,
  resolveTargets,
  roleIdsOf
};
