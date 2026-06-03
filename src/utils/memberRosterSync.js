const db = require('../database/db');
const supaSync = require('./supabaseSync');
const { hasLangGiaRole } = require('./langGiaRole');
const bangchienRoster = require('./bangchienRoster');

const COMBAT_ROLES = {
    DPS: { name: 'DPS', color: 0x0099FF },
    Healer: { name: 'Healer', color: 0x00FF00 },
    Tanker: { name: 'Tanker', color: 0xFF9900 }
};

const WEAPON_ROLES = {
    QD: { name: 'Quạt Dù', color: 0x9B59B6, aliases: ['Quạt Dù', 'Quat Du'] },
    VD: { name: 'Vô Danh', color: 0x3498DB, aliases: ['Vô Danh', 'Vo Danh'] },
    SD: { name: 'Song Đao', color: 0xE74C3C, aliases: ['Song Đao', 'Song Dao'] },
    '9K': { name: 'Cửu Kiếm', color: 0xF39C12, aliases: ['Cửu Kiếm', 'Cuu Kiem'] },
    DR: { name: 'Dù Roi', color: 0xE91E63, aliases: ['Dù Roi', 'Du Roi'] },
    HD: { name: 'Hoành Đao/Mở', color: 0xD35400, aliases: ['Hoành Đao/Mở', 'Hoành Đao/Mđ', 'Hoành Đao', 'Hoanh Dao/Mo', 'Hoanh Dao'] }
};

const ALL_PICKROLE_NAMES = [
    'DPS',
    'Healer',
    'Tanker',
    ...Object.values(WEAPON_ROLES).flatMap((item) => item.aliases)
];

const listeningGuilds = new Set();
let warnedMissingUserColumns = false;
let warnedMissingPendingTable = false;

function getSupabase() {
    return supaSync.getSupabaseClient && supaSync.getSupabaseClient();
}

function normalizeText(value = '') {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeCombatRole(value, fallback = null) {
    const key = normalizeText(value);
    if (key === 'healer') return 'Healer';
    if (key === 'tanker' || key === 'tank') return 'Tanker';
    if (key === 'dps') return 'DPS';
    return fallback;
}

function normalizeWeaponRole(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const upper = raw.toUpperCase().replace('Đ', 'D');
    if (upper === 'HÐ') return 'HD';
    if (WEAPON_ROLES[upper]) return upper;

    const normalized = normalizeText(raw);
    for (const [code, info] of Object.entries(WEAPON_ROLES)) {
        if (info.aliases.some((alias) => normalizeText(alias) === normalized)) return code;
    }
    return null;
}

function isLeftUserRecord(user) {
    return !!user?.left_at || ['khong co', 'left', 'out'].includes(normalizeText(user?.position));
}

function isMissingSchemaError(error) {
    const msg = String(error?.message || error || '');
    return /schema cache|Could not find|does not exist|column .* does not exist|relation .* does not exist/i.test(msg);
}

function hasRole(member, roleName) {
    const target = normalizeText(roleName);
    return member?.roles?.cache?.some((role) => normalizeText(role.name) === target) || false;
}

function getMemberCombatRole(member) {
    if (!member) return null;
    if (hasRole(member, 'Healer')) return 'Healer';
    if (hasRole(member, 'Tanker')) return 'Tanker';
    if (hasRole(member, 'DPS')) return 'DPS';
    for (const info of Object.values(WEAPON_ROLES)) {
        if (info.aliases.some((alias) => hasRole(member, alias))) return 'DPS';
    }
    return null;
}

function getMemberWeaponRole(member) {
    if (!member) return null;
    for (const [code, info] of Object.entries(WEAPON_ROLES)) {
        if (info.aliases.some((alias) => hasRole(member, alias))) return code;
    }
    return null;
}

async function getOrCreateRole(guild, name, color) {
    let role = guild.roles.cache.find((item) => item.name === name);
    if (role) return role;
    role = await guild.roles.create({
        name,
        color,
        reason: 'Sync member roster role from Supabase'
    });
    return role;
}

async function applyDiscordPickRole(guild, discordId, combatRole, weaponRole) {
    if (!guild || !discordId) return false;
    const normalizedCombat = normalizeCombatRole(combatRole, null);
    const normalizedWeapon = normalizedCombat === 'DPS' ? normalizeWeaponRole(weaponRole) : null;
    if (!normalizedCombat) return false;

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return false;

    const rolesToRemove = [];
    for (const roleName of ALL_PICKROLE_NAMES) {
        const role = guild.roles.cache.find((item) => item.name === roleName);
        if (role && member.roles.cache.has(role.id)) rolesToRemove.push(role);
    }

    const rolesToAdd = [];
    const combatConfig = COMBAT_ROLES[normalizedCombat];
    if (combatConfig) {
        rolesToAdd.push(await getOrCreateRole(guild, combatConfig.name, combatConfig.color));
    }

    if (normalizedCombat === 'DPS' && normalizedWeapon) {
        const weaponConfig = WEAPON_ROLES[normalizedWeapon];
        rolesToAdd.push(await getOrCreateRole(guild, weaponConfig.name, weaponConfig.color));
    }

    const addIds = new Set(rolesToAdd.map((role) => role.id));
    const removable = rolesToRemove.filter((role) => !addIds.has(role.id));
    if (removable.length) await member.roles.remove(removable).catch((error) => {
        console.error('[memberRosterSync] remove pick roles failed:', error.message);
    });
    if (rolesToAdd.some((role) => !member.roles.cache.has(role.id))) {
        await member.roles.add(rolesToAdd).catch((error) => {
            console.error('[memberRosterSync] add pick roles failed:', error.message);
        });
    }
    return true;
}

function updateLocalUserRole(discordId, combatRole, weaponRole) {
    const normalizedCombat = normalizeCombatRole(combatRole, null);
    const normalizedWeapon = normalizedCombat === 'DPS' ? normalizeWeaponRole(weaponRole) : null;
    try {
        db.db.prepare(`
            UPDATE users
            SET combat_role = ?,
                weapon_role = ?,
                sub_role = ?,
                role_updated_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE discord_id = ?
        `).run(normalizedCombat, normalizedWeapon, normalizedWeapon, discordId);
    } catch (error) {
        try {
            db.setUserSubRole(discordId, normalizedWeapon);
        } catch (e) { }
    }
    return { combatRole: normalizedCombat, weaponRole: normalizedWeapon };
}

async function updateRoleFromDiscordSelection(member, roleType, dpsTypeOrWeapon, guild = member?.guild) {
    const combatRole = normalizeCombatRole(roleType, roleType === 'dps' ? 'DPS' : null);
    const dpsSlugToWeapon = {
        quatdu: 'QD',
        vodanh: 'VD',
        songdao: 'SD',
        cuukiem: '9K',
        duroi: 'DR',
        hoanhdao: 'HD'
    };
    const weaponRole = combatRole === 'DPS'
        ? normalizeWeaponRole(dpsSlugToWeapon[dpsTypeOrWeapon] || dpsTypeOrWeapon)
        : null;
    updateLocalUserRole(member.id, combatRole, weaponRole);
    await syncUserByDiscordId(member.id, guild);
    await refreshSessionsForUser(guild, member.id);
}

function getLocalPendingByUid(gameUid, guildId) {
    try {
        if (guildId) {
            return db.db.prepare(`
                SELECT * FROM pending_ids
                WHERE game_uid = ? AND (guild_id = ? OR guild_id IS NULL)
                ORDER BY CASE WHEN guild_id = ? THEN 0 ELSE 1 END
                LIMIT 1
            `).get(gameUid, guildId, guildId);
        }
        return db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? LIMIT 1').get(gameUid);
    } catch (error) {
        return null;
    }
}

function buildUserRecord(user, guildId, guild = null) {
    let member = null;
    if (guild && user.discord_id && !String(user.discord_id).startsWith('pending_')) {
        member = guild.members.cache.get(user.discord_id) || null;
    }

    const isTrackedDiscordUser = !!(guild && user.discord_id && !String(user.discord_id).startsWith('pending_'));
    const missingFromGuild = isTrackedDiscordUser && !member;
    const isBotAccount = !!member?.user?.bot;
    const discordCombat = getMemberCombatRole(member);
    const discordWeapon = getMemberWeaponRole(member);
    const combatRole = normalizeCombatRole(user.combat_role, null) || discordCombat || (normalizeWeaponRole(user.weapon_role || user.sub_role) ? 'DPS' : null);
    const weaponRole = combatRole === 'DPS'
        ? (normalizeWeaponRole(user.weapon_role) || normalizeWeaponRole(user.sub_role) || discordWeapon)
        : null;
    const isLeft = isLeftUserRecord(user) || missingFromGuild || isBotAccount;
    const hasLangGia = !isLeft && hasLangGiaRole(member);

    return {
        discord_id: user.discord_id,
        discord_name: user.discord_name,
        game_username: user.game_username,
        game_uid: user.game_uid,
        position: isLeft ? 'Khong co' : (user.position || 'mem'),
        sub_role: weaponRole || user.sub_role || null,
        combat_role: combatRole,
        weapon_role: weaponRole,
        guild_id: guildId || user.guild_id || guild?.id || null,
        lang_gia_member: isLeft ? false : hasLangGia,
        joined_at: user.joined_at || null,
        left_at: user.left_at || null,
        added_by: user.added_by || null,
        source: user.source || 'bot',
        revision: Number.isFinite(Number(user.revision)) ? Number(user.revision) : 0,
        role_updated_at: user.role_updated_at || null
    };
}

function stripNewUserColumns(record) {
    const {
        combat_role,
        weapon_role,
        joined_at,
        left_at,
        added_by,
        source,
        revision,
        role_updated_at,
        ...legacy
    } = record;
    return legacy;
}

async function syncUserRecord(user, guildId, guild = null) {
    const supabase = getSupabase();
    if (!supabase || !user) return false;
    const record = buildUserRecord(user, guildId, guild);
    if (!record.joined_at) delete record.joined_at;
    if (!record.added_by) delete record.added_by;
    let { error } = await supabase
        .from('bc_users')
        .upsert(record, { onConflict: 'discord_id' });

    if (error && isMissingSchemaError(error)) {
        if (!warnedMissingUserColumns) {
            warnedMissingUserColumns = true;
            console.warn('[memberRosterSync] New bc_users columns are missing; falling back to legacy user sync.');
        }
        const retry = await supabase
            .from('bc_users')
            .upsert(stripNewUserColumns(record), { onConflict: 'discord_id' });
        error = retry.error || null;
    }

    if (error) {
        console.error('[memberRosterSync] sync user failed:', error.message);
        return false;
    }
    return true;
}

async function syncUserByDiscordId(discordId, guildOrGuildId = null) {
    const guild = typeof guildOrGuildId === 'object' ? guildOrGuildId : null;
    const guildId = guild?.id || (typeof guildOrGuildId === 'string' ? guildOrGuildId : null);
    const user = db.getUserByDiscordId(discordId, guildId);
    if (!user) return false;
    return syncUserRecord(user, guildId, guild);
}

async function deleteUserFromSupabase(discordId) {
    const supabase = getSupabase();
    if (!supabase || !discordId) return false;
    const { error } = await supabase.from('bc_users').delete().eq('discord_id', discordId);
    if (error) {
        console.error('[memberRosterSync] delete user failed:', error.message);
        return false;
    }
    return true;
}

function buildPendingRecord(row, guildId) {
    return {
        guild_id: guildId || row.guild_id,
        game_uid: row.game_uid,
        game_username: row.game_username,
        joined_at: row.joined_at || null,
        added_by: row.added_by || null,
        added_by_name: row.added_by_name || row.added_by || null,
        source: row.source || 'bot'
    };
}

async function syncPendingByUid(gameUid, guildOrGuildId = null) {
    const supabase = getSupabase();
    if (!supabase || !gameUid) return false;
    const guildId = typeof guildOrGuildId === 'object' ? guildOrGuildId?.id : guildOrGuildId;
    const row = getLocalPendingByUid(gameUid, guildId);
    if (!row) return false;
    const record = buildPendingRecord(row, guildId);
    if (!record.joined_at) delete record.joined_at;
    if (!record.added_by) delete record.added_by;
    if (!record.added_by_name) delete record.added_by_name;
    const { error } = await supabase
        .from('bc_pending_ids')
        .upsert(record, { onConflict: 'guild_id,game_uid' });
    if (error) {
        if (isMissingSchemaError(error)) {
            if (!warnedMissingPendingTable) {
                warnedMissingPendingTable = true;
                console.warn('[memberRosterSync] bc_pending_ids table is missing; skip pending sync until migration is applied.');
            }
            return false;
        }
        console.error('[memberRosterSync] sync pending failed:', error.message);
        return false;
    }
    return true;
}

async function deletePendingFromSupabase(gameUid, guildOrGuildId = null) {
    const supabase = getSupabase();
    if (!supabase || !gameUid) return false;
    const guildId = typeof guildOrGuildId === 'object' ? guildOrGuildId?.id : guildOrGuildId;
    let query = supabase.from('bc_pending_ids').delete().eq('game_uid', gameUid);
    if (guildId) query = query.eq('guild_id', guildId);
    const { error } = await query;
    if (error && !isMissingSchemaError(error)) {
        console.error('[memberRosterSync] delete pending failed:', error.message);
        return false;
    }
    return !error;
}

async function syncAllPending(guildId) {
    const rows = (() => {
        try {
            if (guildId) return db.db.prepare('SELECT * FROM pending_ids WHERE guild_id = ? OR guild_id IS NULL').all(guildId);
            return db.db.prepare('SELECT * FROM pending_ids').all();
        } catch (error) {
            return [];
        }
    })();
    for (const row of rows) {
        await syncPendingByUid(row.game_uid, guildId);
    }
    return rows.length;
}

async function syncAllUsers(guild) {
    const rows = db.getAllUsers ? db.getAllUsers() : [];
    for (const user of rows) {
        await syncUserRecord(user, guild?.id || user.guild_id, guild);
    }
    return rows.length;
}

function applySupabaseUserToLocal(record) {
    if (!record?.discord_id) return null;
    const existing = db.getUserByDiscordId(record.discord_id, record.guild_id);
    const joinedAt = existing?.joined_at || record.joined_at || null;
    const payload = {
        discordId: record.discord_id,
        discordName: record.discord_name || existing?.discord_name || record.discord_id,
        gameUsername: record.game_username || existing?.game_username || record.discord_name || record.discord_id,
        gameUid: record.game_uid || existing?.game_uid || null,
        position: record.left_at ? 'Khong co' : (record.position || existing?.position || 'mem'),
        guildId: record.guild_id || existing?.guild_id || null,
        addedBy: existing?.added_by || record.added_by || null,
        joinedAt,
        combatRole: normalizeCombatRole(record.combat_role, null),
        weaponRole: normalizeWeaponRole(record.weapon_role || record.sub_role),
        source: record.source || 'supabase',
        revision: record.revision || existing?.revision || 0,
        roleUpdatedAt: record.role_updated_at || existing?.role_updated_at || null
    };

    if (existing?.left_at && !record.left_at) db.rejoinUser(record.discord_id, payload);
    else db.upsertUser(payload);

    if (record.left_at || record.lang_gia_member === false || isLeftUserRecord(record)) {
        db.markUserAsLeft(record.discord_id, record.left_at || new Date().toISOString());
    }

    updateLocalUserRole(record.discord_id, payload.combatRole, payload.weaponRole);
    return db.getUserByDiscordId(record.discord_id, record.guild_id);
}

function applySupabasePendingToLocal(record) {
    if (!record?.game_uid || !record?.guild_id) return false;
    try {
        const existing = db.db.prepare(`
            SELECT * FROM pending_ids
            WHERE (supabase_id = ? OR (game_uid = ? AND guild_id = ?))
            LIMIT 1
        `).get(record.id || null, record.game_uid, record.guild_id);

        if (existing) {
            db.db.prepare(`
                UPDATE pending_ids
                SET game_uid = ?,
                    game_username = ?,
                    added_by = ?,
                    added_by_name = ?,
                    joined_at = ?,
                    guild_id = ?,
                    source = ?,
                    supabase_id = ?
                WHERE id = ?
            `).run(
                record.game_uid,
                record.game_username,
                existing.added_by || record.added_by || 'web',
                existing.added_by_name || record.added_by_name || record.added_by || 'web',
                existing.joined_at || record.joined_at || null,
                record.guild_id,
                record.source || 'supabase',
                record.id || existing.supabase_id || null,
                existing.id
            );
        } else {
            db.db.prepare(`
                INSERT INTO pending_ids (game_uid, game_username, added_by, added_by_name, joined_at, guild_id, source, supabase_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                record.game_uid,
                record.game_username,
                record.added_by || 'web',
                record.added_by_name || record.added_by || 'web',
                record.joined_at || null,
                record.guild_id,
                record.source || 'supabase',
                record.id || null
            );
        }
        return true;
    } catch (error) {
        console.error('[memberRosterSync] apply pending local failed:', error.message);
        return false;
    }
}

function deleteLocalPending(record) {
    try {
        if (record?.id) {
            const bySupa = db.db.prepare('DELETE FROM pending_ids WHERE supabase_id = ?').run(record.id);
            if (bySupa.changes > 0) return true;
        }
        if (record?.game_uid && record?.guild_id) {
            db.db.prepare('DELETE FROM pending_ids WHERE game_uid = ? AND guild_id = ?').run(record.game_uid, record.guild_id);
            return true;
        }
    } catch (error) {
        console.error('[memberRosterSync] delete local pending failed:', error.message);
    }
    return false;
}

function sessionContainsUser(session, discordId) {
    return bangchienRoster
        .getAllRosterMembers(session)
        .some((item) => String(item?.id) === String(discordId));
}

async function refreshSessionsForUser(guild, discordId) {
    if (!guild || !supaSync.isReady()) return 0;
    let count = 0;
    const sessions = db.getActiveBangchienByGuild ? db.getActiveBangchienByGuild(guild.id) : [];
    for (const session of sessions) {
        if (!sessionContainsUser(session, discordId)) continue;
        const formatted = supaSync.formatActiveSession(session, db, guild);
        if (formatted) {
            await supaSync.syncBCSession(guild.id, session.day, formatted);
            count++;
        }
    }
    return count;
}

async function pullUsersFromSupabase(guild) {
    const supabase = getSupabase();
    if (!supabase || !guild) return 0;
    const { data, error } = await supabase
        .from('bc_users')
        .select('*')
        .eq('guild_id', guild.id)
        .range(0, 4999);
    if (error) {
        console.error('[memberRosterSync] pull users failed:', error.message);
        return 0;
    }
    for (const record of data || []) {
        applySupabaseUserToLocal(record);
        if (record.combat_role || record.weapon_role) {
            await applyDiscordPickRole(guild, record.discord_id, record.combat_role, record.weapon_role);
        }
    }
    return (data || []).length;
}

async function pullPendingFromSupabase(guildId) {
    const supabase = getSupabase();
    if (!supabase || !guildId) return 0;
    const { data, error } = await supabase
        .from('bc_pending_ids')
        .select('*')
        .eq('guild_id', guildId)
        .range(0, 4999);
    if (error) {
        if (!isMissingSchemaError(error)) console.error('[memberRosterSync] pull pending failed:', error.message);
        return 0;
    }
    for (const record of data || []) applySupabasePendingToLocal(record);
    return (data || []).length;
}

async function countRows(table, guildId) {
    const supabase = getSupabase();
    if (!supabase) return null;
    let query = supabase.from(table).select('*', { count: 'exact', head: true });
    if (guildId) query = query.eq('guild_id', guildId);
    const { count, error } = await query;
    if (error) return null;
    return count || 0;
}

async function bootstrapRoster(guild) {
    if (!guild || !supaSync.isReady()) return;
    const remoteUsers = await countRows('bc_users', guild.id);
    if (remoteUsers === 0) {
        const pushed = await syncAllUsers(guild);
        console.log(`[memberRosterSync] Seeded ${pushed} users to Supabase`);
    } else if (remoteUsers !== null) {
        const pulled = await pullUsersFromSupabase(guild);
        console.log(`[memberRosterSync] Pulled ${pulled} users from Supabase`);
        console.log('[memberRosterSync] Skipped full local user push because Supabase already has roster data.');
    }

    const remotePending = await countRows('bc_pending_ids', guild.id);
    if (remotePending === 0) {
        const pushedPending = await syncAllPending(guild.id);
        console.log(`[memberRosterSync] Seeded ${pushedPending} pending IDs to Supabase`);
    } else if (remotePending !== null) {
        const pulledPending = await pullPendingFromSupabase(guild.id);
        console.log(`[memberRosterSync] Pulled ${pulledPending} pending IDs from Supabase`);
    }
}

function listenForRosterChanges(guild) {
    const supabase = getSupabase();
    if (!supabase || !guild?.id || listeningGuilds.has(guild.id)) return;
    listeningGuilds.add(guild.id);

    supabase
        .channel(`member-roster-${guild.id}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'bc_users', filter: `guild_id=eq.${guild.id}` },
            async (payload) => {
                try {
                    const record = payload.eventType === 'DELETE' ? payload.old : payload.new;
                    if (!record?.discord_id) return;
                    if (payload.eventType === 'DELETE') {
                        db.deleteUser(record.discord_id);
                        await refreshSessionsForUser(guild, record.discord_id);
                        return;
                    }
                    applySupabaseUserToLocal(record);
                    if (record.combat_role || record.weapon_role) {
                        await applyDiscordPickRole(guild, record.discord_id, record.combat_role, record.weapon_role);
                    }
                    await refreshSessionsForUser(guild, record.discord_id);
                } catch (error) {
                    console.error('[memberRosterSync] bc_users realtime handler failed:', error.message);
                }
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'bc_pending_ids', filter: `guild_id=eq.${guild.id}` },
            async (payload) => {
                try {
                    if (payload.eventType === 'DELETE') deleteLocalPending(payload.old);
                    else applySupabasePendingToLocal(payload.new);
                } catch (error) {
                    console.error('[memberRosterSync] bc_pending_ids realtime handler failed:', error.message);
                }
            }
        )
        .subscribe((status) => {
            console.log(`[memberRosterSync] roster realtime ${guild.id}: ${status}`);
        });
}

module.exports = {
    COMBAT_ROLES,
    WEAPON_ROLES,
    normalizeCombatRole,
    normalizeWeaponRole,
    applyDiscordPickRole,
    updateLocalUserRole,
    updateRoleFromDiscordSelection,
    syncUserByDiscordId,
    syncUserRecord,
    deleteUserFromSupabase,
    syncPendingByUid,
    deletePendingFromSupabase,
    syncAllPending,
    bootstrapRoster,
    listenForRosterChanges,
    refreshSessionsForUser
};
