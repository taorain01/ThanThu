const db = require('../database/db');
const supaSync = require('./supabaseSync');
const memberRosterSync = require('./memberRosterSync');

function normalizeText(value = '') {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeStoredPosition(value = 'mem') {
    const normalized = normalizeText(value);
    if (normalized === 'bc' || normalized === 'bang chu') return 'bc';
    if (normalized === 'pbc' || normalized === 'pho guild' || normalized === 'pho bang chu') return 'pbc';
    if (normalized === 'kc' || normalized === 'ky cuu') return 'kc';
    if (normalized === 'ql' || normalized === 'quan ly') return 'Quản Lý';
    return 'mem';
}

function hasAnyRole(member, roleNames = []) {
    if (!member?.roles?.cache) return false;
    const normalizedTargets = roleNames.map(normalizeText);
    return member.roles.cache.some((role) => normalizedTargets.includes(normalizeText(role.name)));
}

function resolveStoredPositionFromDiscord(member, currentPosition = 'mem') {
    if (!member) return currentPosition || 'mem';

    const current = normalizeStoredPosition(currentPosition);
    const hasBangChuRole = hasAnyRole(member, ['Bang Chu']);
    const hasPhoBangChuRole = hasAnyRole(member, ['Pho Guild', 'Pho Bang Chu']);
    const hasQuanLyRole = hasAnyRole(member, ['Quan Ly']);
    const hasKyCuuRole = hasAnyRole(member, ['Ky Cuu']);

    if (hasBangChuRole) return 'bc';
    if (hasPhoBangChuRole) return 'pbc';

    if (hasQuanLyRole) {
        if (current === 'bc' || current === 'pbc') return current;
        return 'Quản Lý';
    }

    if (hasKyCuuRole) {
        if (!current || current === 'mem' || current === 'Quản Lý') return 'kc';
        if (current === 'bc' || current === 'pbc') return 'kc';
        return current;
    }

    return 'mem';
}

async function syncStoredPositionForMember(member, guildId = member?.guild?.id) {
    if (!member?.id) return { changed: false, skipped: true, reason: 'no_member' };

    const user = db.getUserByDiscordId(member.id);
    const nextPosition = resolveStoredPositionFromDiscord(member, user?.position);

    if ((!user || user.left_at) && nextPosition !== 'mem') {
        const ensuredUser = await ensureTrackedMemberFromDiscord(member, nextPosition, guildId);
        return {
            changed: Boolean(ensuredUser),
            position: nextPosition,
            user: ensuredUser || null,
            created: Boolean(ensuredUser)
        };
    }

    if (!user || user.left_at) {
        return { changed: false, skipped: true, reason: 'user_not_active' };
    }

    if ((user.position || 'mem') === nextPosition) {
        return { changed: false, position: nextPosition };
    }

    db.updateUserPosition(member.id, nextPosition);
    const updatedUser = db.getUserByDiscordId(member.id);

    try {
        if (updatedUser && guildId) {
            await memberRosterSync.syncUserRecord(updatedUser, guildId, member.guild);
        }
    } catch (error) {
        console.error('[discordPositionSync] Sync one user failed:', error.message);
    }

    return {
        changed: true,
        from: user.position || 'mem',
        position: nextPosition,
        user: updatedUser
    };
}

async function ensureTrackedMemberFromDiscord(member, position = 'mem', guildId = member?.guild?.id) {
    if (!member?.id) return null;

    const existingUser = db.getUserByDiscordId(member.id);
    const nowIso = new Date().toISOString();
    const payload = {
        discordId: member.id,
        discordName: member.user?.username || member.displayName || member.id,
        gameUsername: existingUser?.game_username || member.displayName || member.user?.username || member.id,
        gameUid: existingUser?.game_uid || null,
        position: normalizeStoredPosition(position),
        serverName: member.guild?.name || existingUser?.server_name || null,
        notes: existingUser?.notes || null,
        joinedAt: existingUser?.joined_at || nowIso
    };

    if (existingUser?.left_at) {
        db.rejoinUser(member.id, payload);
    } else {
        db.upsertUser(payload);
    }

    const updatedUser = db.getUserByDiscordId(member.id);
    try {
        if (updatedUser && guildId) {
            await memberRosterSync.syncUserRecord(updatedUser, guildId, member.guild);
        }
    } catch (error) {
        console.error('[discordPositionSync] ensureTrackedMemberFromDiscord sync failed:', error.message);
    }
    return updatedUser;
}

module.exports = {
    ensureTrackedMemberFromDiscord,
    normalizeStoredPosition,
    resolveStoredPositionFromDiscord,
    syncStoredPositionForMember
};
