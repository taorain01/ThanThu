function roleIdsOf(member) {
  if (!member?.roles?.cache) return [];
  return [...member.roles.cache.keys()].map(String);
}

function evaluateSpeaker(member, config) {
  if (!member) return { allowed: false, reason: 'member_not_found' };
  if (member.user?.bot) return { allowed: false, reason: 'bot_user' };

  const roles = new Set(roleIdsOf(member));
  const blocked = (config.blocked_role_ids || []).map(String);
  if (blocked.some((id) => roles.has(id))) return { allowed: false, reason: 'blocked_role' };

  const callers = (config.caller_role_ids || []).map(String);
  if (!callers.length) return { allowed: false, reason: 'no_caller_roles_configured' };
  if (!callers.some((id) => roles.has(id))) return { allowed: false, reason: 'missing_caller_role' };

  return { allowed: true, reason: 'allowed' };
}

function resolveTargets(config, botId) {
  if (config.mode === 'broadcast') {
    return (config.relay_targets || []).map((x) => Number(x)).filter((x) => x === 1 || x === 2);
  }
  return [Number(botId) === 1 ? 2 : 1];
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
