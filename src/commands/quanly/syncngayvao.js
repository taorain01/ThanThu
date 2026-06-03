const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const supaSync = require('../../utils/supabaseSync');
const { logMemberRosterAction } = require('../../utils/memberRosterLog');
const { ALLOWED_GUILD_ID, isAllowedGuildId } = require('../../config/guildAccess');

const OWNER_IDS = new Set(['395151484179841024', '1247475535317422111']);
const PAGE_LIMIT = 5000;

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function hasSyncPermission(member) {
    return OWNER_IDS.has(member?.id) || member?.roles?.cache?.some(role => normalizeText(role.name) === 'quan ly');
}

function hasColumn(table, column) {
    try {
        return db.db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
    } catch (error) {
        return false;
    }
}

function normalizeJoinedAt(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return `${raw}T00:00:00.000Z`;
    }

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
        const parsedSqliteUtc = new Date(`${raw.replace(' ', 'T')}Z`);
        if (!Number.isNaN(parsedSqliteUtc.getTime())) return parsedSqliteUtc.toISOString();
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function sameJoinedAt(a, b) {
    const left = normalizeJoinedAt(a);
    const right = normalizeJoinedAt(b);
    if (!left || !right) return left === right;
    return Math.abs(new Date(left).getTime() - new Date(right).getTime()) < 1000;
}

function formatDate(value) {
    const normalized = normalizeJoinedAt(value);
    if (!normalized) return 'N/A';
    return `<t:${Math.floor(new Date(normalized).getTime() / 1000)}:d>`;
}

function isLeftPosition(position) {
    return ['khong co', 'left', 'out'].includes(normalizeText(position));
}

function isRemoteActiveUser(row) {
    const discordId = String(row?.discord_id || '').trim();
    if (!discordId || discordId.startsWith('pending_')) return false;
    if (row?.left_at) return false;
    if (isLeftPosition(row?.position)) return false;
    if (Object.prototype.hasOwnProperty.call(row || {}, 'lang_gia_member') && row.lang_gia_member === false) return false;
    return true;
}

function isLocalActiveUser(row) {
    const discordId = String(row?.discord_id || '').trim();
    return !!discordId && !discordId.startsWith('pending_') && !row?.left_at;
}

function getLocalUsers(guildId) {
    const hasGuildId = hasColumn('users', 'guild_id');
    const params = [];
    let sql = `
        SELECT *
        FROM users
        WHERE discord_id IS NOT NULL
    `;

    if (guildId && hasGuildId) {
        sql += ' AND (guild_id = ? OR guild_id IS NULL)';
        params.push(guildId);
    }

    sql += ' ORDER BY game_username COLLATE NOCASE, discord_name COLLATE NOCASE';
    return db.db.prepare(sql).all(...params);
}

function getLocalPending(guildId) {
    try {
        const hasGuildId = hasColumn('pending_ids', 'guild_id');
        const params = [];
        let sql = `
            SELECT game_uid, game_username, joined_at
            FROM pending_ids
            WHERE joined_at IS NOT NULL
              AND joined_at <> ''
        `;
        if (guildId && hasGuildId) {
            sql += ' AND (guild_id = ? OR guild_id IS NULL)';
            params.push(guildId);
        }
        sql += ' ORDER BY game_username COLLATE NOCASE';
        return db.db.prepare(sql).all(...params);
    } catch (error) {
        return [];
    }
}

async function getSupabase() {
    if (!supaSync.isReady()) {
        supaSync.initSupabase();
    }
    const supabase = supaSync.getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase chua san sang. Kiem tra SUPABASE_URL va SUPABASE_SERVICE_KEY tren may bot.');
    }
    return supabase;
}

async function fetchRemoteUsers(supabase, guildId) {
    let query = supabase
        .from('bc_users')
        .select('*')
        .range(0, PAGE_LIMIT - 1);
    if (guildId) query = query.eq('guild_id', guildId);
    const { data, error } = await query;
    if (error) throw new Error(`Khong doc duoc bc_users: ${error.message}`);
    return data || [];
}

async function fetchRemotePending(supabase, guildId) {
    let query = supabase
        .from('bc_pending_ids')
        .select('id,game_uid,game_username,joined_at,guild_id')
        .range(0, PAGE_LIMIT - 1);
    if (guildId) query = query.eq('guild_id', guildId);
    const { data, error } = await query;
    if (error) {
        if (/schema cache|find the table|does not exist|relation/i.test(error.message || '')) return [];
        throw new Error(`Khong doc duoc bc_pending_ids: ${error.message}`);
    }
    return data || [];
}

function buildLocalIndexes(localUsers, localPending) {
    const usersByDiscord = new Map();
    const usersByUid = new Map();
    const pendingByUid = new Map();

    for (const row of localUsers) {
        if (row.discord_id) usersByDiscord.set(String(row.discord_id), row);
        if (row.game_uid) usersByUid.set(String(row.game_uid), row);
    }

    for (const row of localPending) {
        if (row.game_uid) pendingByUid.set(String(row.game_uid), row);
    }

    return { usersByDiscord, usersByUid, pendingByUid };
}

function findLocalDateSource(row, indexes) {
    const byDiscord = row?.discord_id ? indexes.usersByDiscord.get(String(row.discord_id)) : null;
    if (byDiscord?.joined_at) return { source: byDiscord, sourceType: 'discord_id' };

    const byUid = row?.game_uid ? indexes.usersByUid.get(String(row.game_uid)) : null;
    if (byUid?.joined_at) return { source: byUid, sourceType: 'game_uid' };

    const byPendingUid = row?.game_uid ? indexes.pendingByUid.get(String(row.game_uid)) : null;
    if (byPendingUid?.joined_at) return { source: byPendingUid, sourceType: 'pending_uid' };

    return null;
}

function buildUserPlan(remoteRows, indexes) {
    const plan = [];
    let missingLocalDate = 0;
    let same = 0;
    let invalidLocalDate = 0;

    for (const remote of remoteRows) {
        const localDateSource = findLocalDateSource(remote, indexes);
        if (!localDateSource) {
            missingLocalDate++;
            continue;
        }

        const joinedAt = normalizeJoinedAt(localDateSource.source.joined_at);
        if (!joinedAt) {
            invalidLocalDate++;
            continue;
        }

        if (sameJoinedAt(joinedAt, remote.joined_at)) {
            same++;
            continue;
        }

        plan.push({
            type: 'user',
            id: String(remote.discord_id),
            name: remote.game_username || remote.discord_name || remote.discord_id,
            gameUid: remote.game_uid || null,
            localJoinedAt: joinedAt,
            remoteJoinedAt: remote.joined_at || null,
            sourceType: localDateSource.sourceType
        });
    }

    return { plan, missingLocalDate, same, invalidLocalDate, remoteCount: remoteRows.length };
}

function buildPendingPlan(remoteRows, indexes) {
    const plan = [];
    let missingLocalDate = 0;
    let same = 0;
    let invalidLocalDate = 0;

    for (const remote of remoteRows) {
        const localDateSource = findLocalDateSource(remote, indexes);
        if (!localDateSource) {
            missingLocalDate++;
            continue;
        }

        const joinedAt = normalizeJoinedAt(localDateSource.source.joined_at);
        if (!joinedAt) {
            invalidLocalDate++;
            continue;
        }

        if (sameJoinedAt(joinedAt, remote.joined_at)) {
            same++;
            continue;
        }

        plan.push({
            type: 'pending',
            id: String(remote.game_uid),
            remoteId: remote.id || null,
            name: remote.game_username || remote.game_uid,
            gameUid: remote.game_uid,
            localJoinedAt: joinedAt,
            remoteJoinedAt: remote.joined_at || null,
            sourceType: localDateSource.sourceType
        });
    }

    return { plan, missingLocalDate, same, invalidLocalDate, remoteCount: remoteRows.length };
}

function buildLocalRosterPlan(localUsers, remoteActiveUsers) {
    const localByDiscord = new Map(
        localUsers
            .filter(row => row.discord_id && !String(row.discord_id).startsWith('pending_'))
            .map(row => [String(row.discord_id), row])
    );
    const remoteIds = new Set(remoteActiveUsers.map(row => String(row.discord_id)).filter(Boolean));
    const localActive = localUsers.filter(isLocalActiveUser);
    const localOnlyActive = localActive.filter(row => !remoteIds.has(String(row.discord_id)));

    let missingLocal = 0;
    let reactivatedLocal = 0;
    let existingLocal = 0;
    const missingLocalRows = [];
    const reactivatedLocalRows = [];
    for (const remote of remoteActiveUsers) {
        const local = localByDiscord.get(String(remote.discord_id));
        if (!local) {
            missingLocal++;
            missingLocalRows.push(remote);
        } else if (local.left_at) {
            reactivatedLocal++;
            reactivatedLocalRows.push(remote);
        } else {
            existingLocal++;
        }
    }

    return {
        remoteActiveCount: remoteActiveUsers.length,
        localActiveCount: localActive.length,
        localOnlyActive,
        missingLocal,
        missingLocalRows,
        reactivatedLocal,
        reactivatedLocalRows,
        existingLocal
    };
}

function compactName(value, maxLength = 18) {
    const text = String(value || 'N/A').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function formatDateLine(item) {
    const source = item.sourceType ? `/${item.sourceType}` : '';
    return `${compactName(item.name)} (${item.id}) ${formatDate(item.remoteJoinedAt)} -> ${formatDate(item.localJoinedAt)}${source}`;
}

function formatRemoteUserLine(row) {
    const name = row.game_username || row.discord_name || row.discord_id;
    const uid = row.game_uid ? ` UID:${row.game_uid}` : '';
    return `${compactName(name)} (${row.discord_id})${uid}`;
}

function formatLocalUserLine(row) {
    const name = row.game_username || row.discord_name || row.discord_id;
    const uid = row.game_uid ? ` UID:${row.game_uid}` : '';
    return `${compactName(name)} (${row.discord_id})${uid} ${formatDate(row.joined_at)}`;
}

function splitLinesForField(lines, maxChars = 900) {
    const chunks = [];
    let current = [];
    let length = 0;

    for (const rawLine of lines) {
        const line = String(rawLine || '').slice(0, 180);
        const extra = line.length + (current.length > 0 ? 1 : 0);
        if (current.length > 0 && length + extra > maxChars) {
            chunks.push(current);
            current = [];
            length = 0;
        }
        current.push(line);
        length += extra;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}

function pushDetailFields(embeds, title, lines, color) {
    if (!lines.length) return;

    const chunks = splitLinesForField(lines);
    let embed = null;
    let part = 1;
    const maxFieldsPerEmbed = 6;

    for (const chunk of chunks) {
        if (!embed || (embed.data.fields?.length || 0) >= maxFieldsPerEmbed) {
            embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(title);
            embeds.push(embed);
        }

        embed.addFields({
            name: `${title} #${part}`,
            value: chunk.join('\n'),
            inline: true
        });
        part++;
    }
}

function buildPreviewEmbeds({ guildId, userStats, pendingStats, rosterStats, applyResult = null }) {
    const userPlan = userStats.plan;
    const pendingPlan = pendingStats.plan;
    const totalPlan = userPlan.length + pendingPlan.length;
    const isApply = !!applyResult;
    const embed = new EmbedBuilder()
        .setColor(isApply ? 0x2ECC71 : 0xF59E0B)
        .setTitle(isApply ? 'Da sync ngay vao len Supabase' : 'Preview sync ngay vao len Supabase')
        .setDescription([
            `Guild: \`${guildId || 'all'}\``,
            `Roster chuan: Supabase active`,
            `Nguon ngay: SQLite bot hien tai`,
            '',
            `bc_users se update: **${userPlan.length}**`,
            `bc_pending_ids se update: **${pendingPlan.length}**`,
            `Tong row se update: **${totalPlan}**`,
            '',
            `Supabase active users: ${rosterStats.remoteActiveCount}`,
            `SQLite active users truoc sync: ${rosterStats.localActiveCount}`,
            `Supabase user moi se ghi vao SQLite: ${rosterStats.missingLocal}`,
            `SQLite user cu khong con tren Supabase se mark left: ${rosterStats.localOnlyActive.length}`,
            `SQLite user left nhung Supabase active se mo lai: ${rosterStats.reactivatedLocal}`,
            '',
            `Users trung ngay: ${userStats.same} | Supabase user khong co ngay local: ${userStats.missingLocalDate} | ngay local loi: ${userStats.invalidLocalDate}`,
            `Pending trung ngay: ${pendingStats.same} | pending khong co ngay local: ${pendingStats.missingLocalDate} | ngay local loi: ${pendingStats.invalidLocalDate}`
        ].join('\n'))
        .setTimestamp();

    if (isApply) {
        embed.addFields({
            name: 'Ket qua',
            value: [
                `bc_users updated: ${applyResult.usersUpdated}`,
                `bc_pending_ids updated: ${applyResult.pendingUpdated}`,
                `SQLite inserted/updated: ${applyResult.localUpserted}`,
                `SQLite marked left: ${applyResult.localMarkedLeft}`,
                `failed: ${applyResult.failed}`
            ].join('\n')
        });
    } else {
        embed.addFields({
            name: 'Chua ghi',
            value: 'Chay `?syncngayvao confirm` de ghi de rieng cot ngay vao tren Supabase.'
        });
    }

    const embeds = [embed];
    pushDetailFields(embeds, 'Ngay user se de', userPlan.map(formatDateLine), isApply ? 0x2ECC71 : 0xF59E0B);
    pushDetailFields(embeds, 'Ngay pending se de', pendingPlan.map(formatDateLine), isApply ? 0x2ECC71 : 0xF59E0B);
    pushDetailFields(embeds, 'Supabase moi -> SQLite', rosterStats.missingLocalRows.map(formatRemoteUserLine), 0x3498DB);
    pushDetailFields(embeds, 'SQLite left -> active lai', rosterStats.reactivatedLocalRows.map(formatRemoteUserLine), 0x9B59B6);
    pushDetailFields(embeds, 'SQLite cu -> mark left', rosterStats.localOnlyActive.map(formatLocalUserLine), 0xE67E22);
    return embeds;
}

function getRemoteJoinedAtForLocal(remote, indexes) {
    const localDateSource = findLocalDateSource(remote, indexes);
    return normalizeJoinedAt(localDateSource?.source?.joined_at) || normalizeJoinedAt(remote.joined_at);
}

function applyRemoteUsersToLocal(remoteUsers, indexes, guildId) {
    if (remoteUsers.length === 0) return 0;

    const stmt = db.db.prepare(`
        INSERT INTO users (
            discord_id, discord_name, game_username, game_uid, position, guild_id,
            added_by, joined_at, combat_role, weapon_role, sub_role, source, revision, role_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'supabase', ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            discord_name = COALESCE(excluded.discord_name, users.discord_name),
            game_username = COALESCE(excluded.game_username, users.game_username),
            game_uid = COALESCE(excluded.game_uid, users.game_uid),
            position = COALESCE(excluded.position, users.position),
            guild_id = COALESCE(excluded.guild_id, users.guild_id),
            added_by = COALESCE(users.added_by, excluded.added_by),
            joined_at = COALESCE(excluded.joined_at, users.joined_at),
            combat_role = COALESCE(excluded.combat_role, users.combat_role),
            weapon_role = COALESCE(excluded.weapon_role, users.weapon_role),
            sub_role = COALESCE(excluded.sub_role, users.sub_role),
            source = COALESCE(excluded.source, users.source),
            revision = COALESCE(excluded.revision, users.revision),
            role_updated_at = COALESCE(excluded.role_updated_at, users.role_updated_at),
            left_at = NULL,
            updated_at = CURRENT_TIMESTAMP
    `);

    const tx = db.db.transaction((rows) => {
        let changes = 0;
        for (const remote of rows) {
            const combatRole = remote.combat_role || null;
            const weaponRole = remote.weapon_role || null;
            const subRole = remote.sub_role || null;
            const joinedAt = getRemoteJoinedAtForLocal(remote, indexes);
            const revision = Number.isFinite(Number(remote.revision)) ? Number(remote.revision) : null;
            changes += stmt.run(
                String(remote.discord_id),
                remote.discord_name || String(remote.discord_id),
                remote.game_username || remote.discord_name || String(remote.discord_id),
                remote.game_uid || null,
                remote.position || 'mem',
                remote.guild_id || guildId || null,
                remote.added_by || null,
                joinedAt || null,
                combatRole,
                weaponRole,
                subRole,
                revision,
                remote.role_updated_at || null
            ).changes;
        }
        return changes;
    });

    return tx(remoteUsers);
}

function markLocalOnlyUsersLeft(localOnlyActive) {
    const leftAt = new Date().toISOString();
    let changes = 0;
    for (const local of localOnlyActive) {
        changes += db.markUserAsLeft(local.discord_id, leftAt).changes || 0;
    }
    return changes;
}

async function sendEmbedsAsMessages(channel, embeds) {
    for (const embed of embeds) {
        await channel.send({ embeds: [embed] });
    }
}

async function applyPlan(supabase, userPlan, pendingPlan, guildId, remoteActiveUsers, indexes, rosterStats) {
    const result = { usersUpdated: 0, pendingUpdated: 0, localUpserted: 0, localMarkedLeft: 0, failed: 0 };

    for (const item of userPlan) {
        let query = supabase
            .from('bc_users')
            .update({ joined_at: item.localJoinedAt }, { count: 'exact' })
            .eq('discord_id', item.id);
        if (guildId) query = query.eq('guild_id', guildId);
        const { count, error } = await query;
        if (error) {
            result.failed++;
            console.error(`[syncngayvao] update bc_users ${item.id} failed:`, error.message);
        } else {
            result.usersUpdated += count ?? 1;
        }
    }

    for (const item of pendingPlan) {
        let query = supabase
            .from('bc_pending_ids')
            .update({ joined_at: item.localJoinedAt }, { count: 'exact' });
        if (item.remoteId) query = query.eq('id', item.remoteId);
        else query = query.eq('game_uid', item.gameUid);
        if (guildId) query = query.eq('guild_id', guildId);
        const { count, error } = await query;
        if (error) {
            result.failed++;
            console.error(`[syncngayvao] update bc_pending_ids ${item.gameUid} failed:`, error.message);
        } else {
            result.pendingUpdated += count ?? 1;
        }
    }

    try {
        result.localUpserted = applyRemoteUsersToLocal(remoteActiveUsers, indexes, guildId);
        result.localMarkedLeft = markLocalOnlyUsersLeft(rosterStats.localOnlyActive);
    } catch (error) {
        result.failed++;
        console.error('[syncngayvao] local roster sync failed:', error.message);
    }

    return result;
}

async function execute(message, args) {
    if (!isAllowedGuildId(message.guild?.id)) return;

    if (!hasSyncPermission(message.member)) {
        return message.reply('Ban khong co quyen dung lenh nay. Yeu cau owner hoac role Quan Ly.');
    }

    const flags = new Set(args.map(arg => String(arg || '').toLowerCase()));
    const isConfirm = flags.has('confirm') || flags.has('xacnhan') || flags.has('run');
    const guildId = message.guild?.id || ALLOWED_GUILD_ID;

    let supabase;
    try {
        supabase = await getSupabase();
    } catch (error) {
        return message.reply(error.message);
    }

    try {
        const [remoteUsers, remotePending] = await Promise.all([
            fetchRemoteUsers(supabase, guildId),
            fetchRemotePending(supabase, guildId)
        ]);

        const remoteActiveUsers = remoteUsers.filter(isRemoteActiveUser);
        const localPending = getLocalPending(guildId);
        const localUsers = getLocalUsers(guildId);
        const indexes = buildLocalIndexes(localUsers, localPending);
        const userStats = buildUserPlan(remoteActiveUsers, indexes);
        const pendingStats = buildPendingPlan(remotePending, indexes);
        const rosterStats = buildLocalRosterPlan(localUsers, remoteActiveUsers);

        if (!isConfirm) {
            await sendEmbedsAsMessages(message.channel, buildPreviewEmbeds({ guildId, userStats, pendingStats, rosterStats }));
            return;
        }

        const applyResult = await applyPlan(supabase, userStats.plan, pendingStats.plan, guildId, remoteActiveUsers, indexes, rosterStats);

        void logMemberRosterAction(guildId, 'member_update', {
            summary: `Sync ngay vao len Supabase: ${applyResult.usersUpdated + applyResult.pendingUpdated} rows`,
            actor_id: message.author.id,
            actor_name: message.author.username,
            target_type: 'bulk',
            target_id: guildId,
            target_name: 'sync joined_at',
            changes: [
                { field: 'bc_users.joined_at', label: 'bc_users ngay vao', before: null, after: applyResult.usersUpdated },
                { field: 'bc_pending_ids.joined_at', label: 'pending ngay vao', before: null, after: applyResult.pendingUpdated },
                { field: 'local_upserted', label: 'SQLite sync Supabase users', before: null, after: applyResult.localUpserted },
                { field: 'local_marked_left', label: 'SQLite old users marked left', before: null, after: applyResult.localMarkedLeft }
            ],
            counts: applyResult,
            sample: [...userStats.plan, ...pendingStats.plan].slice(0, 20).map(item => ({
                type: item.type,
                id: item.id,
                name: item.name,
                before: item.remoteJoinedAt,
                after: item.localJoinedAt
            }))
        }, message.author.id);

        await sendEmbedsAsMessages(message.channel, buildPreviewEmbeds({ guildId, userStats, pendingStats, rosterStats, applyResult }));
        return;
    } catch (error) {
        console.error('[syncngayvao] failed:', error);
        return message.reply(`Co loi khi sync ngay vao: ${error.message}`);
    }
}

module.exports = { execute };
