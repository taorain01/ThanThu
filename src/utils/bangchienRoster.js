const MAX_ACTIVE_MEMBERS = 30;
const MAX_TEAMS = 8;

const LEGACY_TEAM_KEYS = ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];
const LEGACY_SIZE_KEYS = {
    team_attack1: 'attack1',
    team_attack2: 'attack2',
    team_defense: 'defense',
    team_forest: 'forest'
};
const LEGACY_LEADER_KEYS = {
    team_attack1: 'team1',
    team_attack2: 'team2',
    team_defense: 'team3',
    team_forest: 'team4'
};

const DEFAULT_TEAM_LAYOUT = [
    { id: 'team_attack1', name: 'TEAM CONG 1', icon: 'ATK', capacity: 10, order: 1 },
    { id: 'team_attack2', name: 'TEAM CONG 2', icon: 'ATK', capacity: 10, order: 2 },
    { id: 'team_defense', name: 'TEAM THU', icon: 'DEF', capacity: 5, order: 3 },
    { id: 'team_forest', name: 'TEAM RUNG', icon: 'JNG', capacity: 5, order: 4 }
];

const DEFAULT_TEAM_NAMES = {
    attack1: 'TEAM CONG 1',
    attack2: 'TEAM CONG 2',
    defense: 'TEAM THU',
    forest: 'TEAM RUNG'
};

function parseJson(value, fallback) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value;
    if (typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value || '');
    } catch (error) {
        return fallback;
    }
}

function cloneMember(member) {
    return member && typeof member === 'object' ? { ...member } : member;
}

function normalizeId(value, fallback) {
    const raw = String(value || fallback || '').trim();
    return raw.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || fallback;
}

function getLegacySizes(session = {}) {
    const raw = parseJson(session.team_sizes, session.team_sizes || {});
    return {
        attack1: Number(raw.attack1 ?? 10) || 0,
        attack2: Number(raw.attack2 ?? 10) || 0,
        defense: Number(raw.defense ?? 5) || 0,
        forest: Number(raw.forest ?? 5) || 0
    };
}

function getLegacyNames(session = {}) {
    const raw = parseJson(session.team_names, session.team_names || {});
    return {
        attack1: raw.attack1 || DEFAULT_TEAM_NAMES.attack1,
        attack2: raw.attack2 || DEFAULT_TEAM_NAMES.attack2,
        defense: raw.defense || DEFAULT_TEAM_NAMES.defense,
        forest: raw.forest || DEFAULT_TEAM_NAMES.forest
    };
}

function buildDefaultLayout(session = {}) {
    const sizes = getLegacySizes(session);
    const names = getLegacyNames(session);
    return DEFAULT_TEAM_LAYOUT.map((team) => {
        const sizeKey = LEGACY_SIZE_KEYS[team.id];
        return {
            ...team,
            name: names[sizeKey] || team.name,
            capacity: Math.max(0, Number(sizes[sizeKey] ?? team.capacity) || 0)
        };
    }).filter((team) => team.capacity > 0);
}

function normalizeLayout(rawLayout, session = {}) {
    const source = parseJson(rawLayout ?? session.team_layout, null);
    let layout = Array.isArray(source) && source.length ? source : buildDefaultLayout(session);
    const seen = new Set();
    layout = layout
        .map((team, index) => {
            const fallback = LEGACY_TEAM_KEYS[index] || `team_custom_${index + 1}`;
            let id = normalizeId(team?.id, fallback);
            while (seen.has(id)) id = `${id}_${index + 1}`;
            seen.add(id);
            return {
                id,
                name: String(team?.name || DEFAULT_TEAM_LAYOUT[index]?.name || `TEAM ${index + 1}`).trim().slice(0, 32),
                icon: String(team?.icon || DEFAULT_TEAM_LAYOUT[index]?.icon || 'ATK').trim().slice(0, 8),
                capacity: Math.max(1, Math.min(MAX_ACTIVE_MEMBERS, Number(team?.capacity ?? DEFAULT_TEAM_LAYOUT[index]?.capacity ?? 1) || 1)),
                order: Number.isFinite(Number(team?.order)) ? Number(team.order) : index + 1
            };
        })
        .sort((a, b) => a.order - b.order)
        .slice(0, MAX_TEAMS)
        .map((team, index) => ({ ...team, order: index + 1 }));

    const total = layout.reduce((sum, team) => sum + team.capacity, 0);
    if (total !== MAX_ACTIVE_MEMBERS && !Array.isArray(source)) {
        return DEFAULT_TEAM_LAYOUT.map((team) => ({ ...team }));
    }
    return layout;
}

function normalizeTeams(rawTeams, layout, session = {}) {
    const parsed = parseJson(rawTeams ?? session.teams ?? session.teams_json, null);
    const teams = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const team of layout) {
            teams[team.id] = Array.isArray(parsed[team.id])
                ? parsed[team.id].map(cloneMember)
                : [];
        }
    } else {
        for (const team of layout) {
            teams[team.id] = Array.isArray(session[team.id])
                ? session[team.id].map(cloneMember)
                : parseJson(session[team.id], []).map(cloneMember);
        }
    }
    return teams;
}

function normalizeRoster(session = {}) {
    const layout = normalizeLayout(session.team_layout, session);
    const teams = normalizeTeams(session.teams ?? session.teams_json, layout, session);
    const waitingList = Array.isArray(session.waiting_list)
        ? session.waiting_list.map(cloneMember)
        : parseJson(session.waiting_list, []).map(cloneMember);
    return { layout, teams, waitingList };
}

function getTotalCapacity(rosterOrSession) {
    const layout = Array.isArray(rosterOrSession?.layout)
        ? rosterOrSession.layout
        : normalizeRoster(rosterOrSession).layout;
    return layout.reduce((sum, team) => sum + (Number(team.capacity) || 0), 0);
}

function getActiveRosterMembers(rosterOrSession) {
    const roster = rosterOrSession?.layout && rosterOrSession?.teams
        ? rosterOrSession
        : normalizeRoster(rosterOrSession);
    return roster.layout.flatMap((team) => (roster.teams[team.id] || []).map((member) => ({
        ...member,
        team: team.id,
        teamId: team.id,
        teamName: team.name
    })));
}

function getAllRosterMembers(rosterOrSession) {
    const roster = rosterOrSession?.layout && rosterOrSession?.teams
        ? rosterOrSession
        : normalizeRoster(rosterOrSession);
    return [
        ...getActiveRosterMembers(roster),
        ...roster.waitingList.map((member) => ({ ...member, team: 'waiting_list', teamId: 'waiting_list', teamName: 'Hang cho' }))
    ];
}

function findMember(rosterOrSession, userId) {
    const roster = rosterOrSession?.layout && rosterOrSession?.teams
        ? rosterOrSession
        : normalizeRoster(rosterOrSession);
    for (const team of roster.layout) {
        const list = roster.teams[team.id] || [];
        const index = list.findIndex((member) => String(member?.id) === String(userId));
        if (index !== -1) return { teamId: team.id, index, member: list[index], waiting: false };
    }
    const waitIndex = roster.waitingList.findIndex((member) => String(member?.id) === String(userId));
    if (waitIndex !== -1) return { teamId: 'waiting_list', index: waitIndex, member: roster.waitingList[waitIndex], waiting: true };
    return null;
}

function getRosterCounts(rosterOrSession) {
    const roster = rosterOrSession?.layout && rosterOrSession?.teams
        ? rosterOrSession
        : normalizeRoster(rosterOrSession);
    const byTeam = {};
    for (const team of roster.layout) byTeam[team.id] = (roster.teams[team.id] || []).length;
    return {
        byTeam,
        active: Object.values(byTeam).reduce((sum, count) => sum + count, 0),
        waiting: roster.waitingList.length,
        total: Object.values(byTeam).reduce((sum, count) => sum + count, 0) + roster.waitingList.length,
        attack1: byTeam.team_attack1 || 0,
        attack2: byTeam.team_attack2 || 0,
        defense: byTeam.team_defense || 0,
        forest: byTeam.team_forest || 0
    };
}

function getTeamDisplayName(rosterOrSession, teamId) {
    if (teamId === 'waiting' || teamId === 'waiting_list') return 'Hang cho';
    const roster = rosterOrSession?.layout && rosterOrSession?.teams
        ? rosterOrSession
        : normalizeRoster(rosterOrSession);
    return roster.layout.find((team) => team.id === teamId)?.name || teamId;
}

function buildLegacyMirrors(roster) {
    const sizes = {};
    const names = {};
    const legacyTeams = {};
    roster.layout.slice(0, LEGACY_TEAM_KEYS.length).forEach((team, index) => {
        const legacyKey = LEGACY_TEAM_KEYS[index];
        const sizeKey = LEGACY_SIZE_KEYS[legacyKey];
        legacyTeams[legacyKey] = (roster.teams[team.id] || []).map((member) => ({
            ...member,
            team: legacyKey
        }));
        sizes[sizeKey] = team.capacity;
        names[sizeKey] = team.name;
    });
    for (const legacyKey of LEGACY_TEAM_KEYS) {
        if (!legacyTeams[legacyKey]) legacyTeams[legacyKey] = [];
    }
    return {
        team_attack1: legacyTeams.team_attack1,
        team_attack2: legacyTeams.team_attack2,
        team_defense: legacyTeams.team_defense,
        team_forest: legacyTeams.team_forest,
        waiting_list: roster.waitingList || [],
        team_sizes: {
            attack1: sizes.attack1 ?? 0,
            attack2: sizes.attack2 ?? 0,
            defense: sizes.defense ?? 0,
            forest: sizes.forest ?? 0
        },
        team_names: {
            attack1: names.attack1 || DEFAULT_TEAM_NAMES.attack1,
            attack2: names.attack2 || DEFAULT_TEAM_NAMES.attack2,
            defense: names.defense || DEFAULT_TEAM_NAMES.defense,
            forest: names.forest || DEFAULT_TEAM_NAMES.forest
        }
    };
}

function serializeRosterForStorage(roster) {
    const normalized = {
        layout: normalizeLayout(roster.layout, { team_layout: roster.layout }),
        teams: {},
        waitingList: Array.isArray(roster.waitingList) ? roster.waitingList.map(cloneMember) : []
    };
    for (const team of normalized.layout) {
        normalized.teams[team.id] = Array.isArray(roster.teams?.[team.id])
            ? roster.teams[team.id].map(cloneMember)
            : [];
    }
    const legacy = buildLegacyMirrors(normalized);
    return {
        ...legacy,
        team_layout: JSON.stringify(normalized.layout),
        teams_json: JSON.stringify(normalized.teams),
        teams: JSON.stringify(normalized.teams),
        waiting_list: legacy.waiting_list
    };
}

function assignParticipant(session, participant, options = {}) {
    const roster = normalizeRoster(session);
    if (findMember(roster, participant.id)) {
        return { success: false, error: 'Already registered' };
    }
    const newParticipant = {
        ...participant,
        joinedAt: participant.joinedAt || Date.now(),
        isLeader: !!participant.isLeader
    };
    let targetTeam = 'waiting_list';
    if (!options.locked && session?.locked !== true) {
        const target = roster.layout.find((team) => (roster.teams[team.id] || []).length < team.capacity);
        if (target) {
            roster.teams[target.id].push(newParticipant);
            targetTeam = target.id;
        } else {
            roster.waitingList.push(newParticipant);
        }
    } else {
        roster.waitingList.push(newParticipant);
    }
    return {
        success: true,
        roster,
        storage: serializeRosterForStorage(roster),
        team: targetTeam,
        teamId: targetTeam,
        teamName: getTeamDisplayName(roster, targetTeam),
        counts: getRosterCounts(roster)
    };
}

function promoteWaiting(roster) {
    if (!roster.waitingList.length) return null;
    const target = roster.layout.find((team) => (roster.teams[team.id] || []).length < team.capacity);
    if (!target) return null;
    const promoted = roster.waitingList.shift();
    roster.teams[target.id].push(promoted);
    return { member: promoted, teamId: target.id };
}

function removeParticipant(session, userId, options = {}) {
    const roster = normalizeRoster(session);
    const found = findMember(roster, userId);
    if (!found) return { success: false, error: 'Not found in session' };
    if (!found.waiting) {
        const member = roster.teams[found.teamId][found.index];
        if ((member?.isLeader || member?.ld || member?.isTeamLeader) && options.allowLeader !== true) {
            return { success: false, error: 'Leader cannot leave' };
        }
        roster.teams[found.teamId].splice(found.index, 1);
        if (options.promote !== false) promoteWaiting(roster);
    } else {
        roster.waitingList.splice(found.index, 1);
    }
    return {
        success: true,
        roster,
        storage: serializeRosterForStorage(roster),
        team: found.teamId,
        teamId: found.teamId,
        counts: getRosterCounts(roster)
    };
}

function applyRosterUpdate(session, updates = {}) {
    let roster;
    if (updates.team_layout !== undefined || updates.teams !== undefined || updates.teams_json !== undefined) {
        roster = normalizeRoster({
            ...session,
            team_layout: updates.team_layout ?? session.team_layout,
            teams: updates.teams ?? updates.teams_json ?? session.teams ?? session.teams_json,
            waiting_list: updates.waiting_list ?? session.waiting_list
        });
    } else {
        roster = normalizeRoster(session);
        for (const key of LEGACY_TEAM_KEYS) {
            if (updates[key] !== undefined) {
                roster.teams[key] = Array.isArray(updates[key]) ? updates[key].map(cloneMember) : parseJson(updates[key], []).map(cloneMember);
            }
        }
        if (updates.waiting_list !== undefined) {
            roster.waitingList = Array.isArray(updates.waiting_list)
                ? updates.waiting_list.map(cloneMember)
                : parseJson(updates.waiting_list, []).map(cloneMember);
        }
    }
    return {
        roster,
        storage: serializeRosterForStorage(roster),
        counts: getRosterCounts(roster)
    };
}

function attachRosterFields(session) {
    if (!session) return session;
    const roster = normalizeRoster(session);
    const legacy = buildLegacyMirrors(roster);
    session.team_layout = roster.layout;
    session.teams = roster.teams;
    session.teams_json = JSON.stringify(roster.teams);
    session.team_attack1 = legacy.team_attack1;
    session.team_attack2 = legacy.team_attack2;
    session.team_defense = legacy.team_defense;
    session.team_forest = legacy.team_forest;
    session.waiting_list = legacy.waiting_list;
    session.team_sizes = legacy.team_sizes;
    session.team_names = legacy.team_names;
    return session;
}

module.exports = {
    MAX_ACTIVE_MEMBERS,
    MAX_TEAMS,
    LEGACY_TEAM_KEYS,
    LEGACY_SIZE_KEYS,
    LEGACY_LEADER_KEYS,
    DEFAULT_TEAM_LAYOUT,
    parseJson,
    normalizeLayout,
    normalizeRoster,
    serializeRosterForStorage,
    attachRosterFields,
    assignParticipant,
    removeParticipant,
    applyRosterUpdate,
    getActiveRosterMembers,
    getAllRosterMembers,
    getRosterCounts,
    getTotalCapacity,
    getTeamDisplayName,
    findMember
};
