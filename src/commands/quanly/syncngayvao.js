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

function getLocalUsers(guildId, includeLeft = false) {
    const hasGuildId = hasColumn('users', 'guild_id');
    const hasLeftAt = hasColumn('users', 'left_at');
    const params = [];
    let sql = `
        SELECT discord_id, discord_name, game_username, game_uid, position, joined_at, ${hasLeftAt ? 'left_at' : 'NULL AS left_at'}
        FROM users
        WHERE joined_at IS NOT NULL
          AND joined_at <> ''
          AND discord_id IS NOT NULL
          AND discord_id NOT LIKE 'pending_%'
    `;

    if (!includeLeft && hasLeftAt) {
        sql += ' AND left_at IS NULL';
    }

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
        .select('discord_id,discord_name,game_username,game_uid,joined_at,guild_id')
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

function buildUserPlan(localRows, remoteRows) {
    const remoteByDiscord = new Map(
        remoteRows
            .filter(row => row.discord_id)
            .map(row => [String(row.discord_id), row])
    );

    const plan = [];
    let missingRemote = 0;
    let same = 0;
    let invalidLocalDate = 0;

    for (const local of localRows) {
        const joinedAt = normalizeJoinedAt(local.joined_at);
        if (!joinedAt) {
            invalidLocalDate++;
            continue;
        }

        const remote = remoteByDiscord.get(String(local.discord_id));
        if (!remote) {
            missingRemote++;
            continue;
        }

        if (sameJoinedAt(joinedAt, remote.joined_at)) {
            same++;
            continue;
        }

        plan.push({
            type: 'user',
            id: String(local.discord_id),
            name: local.game_username || local.discord_name || local.discord_id,
            gameUid: local.game_uid || null,
            localJoinedAt: joinedAt,
            remoteJoinedAt: remote.joined_at || null
        });
    }

    return { plan, missingRemote, same, invalidLocalDate };
}

function buildPendingPlan(localRows, remoteRows) {
    const remoteByUid = new Map(
        remoteRows
            .filter(row => row.game_uid)
            .map(row => [String(row.game_uid), row])
    );

    const plan = [];
    let missingRemote = 0;
    let same = 0;
    let invalidLocalDate = 0;

    for (const local of localRows) {
        const joinedAt = normalizeJoinedAt(local.joined_at);
        if (!joinedAt) {
            invalidLocalDate++;
            continue;
        }

        const remote = remoteByUid.get(String(local.game_uid));
        if (!remote) {
            missingRemote++;
            continue;
        }

        if (sameJoinedAt(joinedAt, remote.joined_at)) {
            same++;
            continue;
        }

        plan.push({
            type: 'pending',
            id: String(local.game_uid),
            remoteId: remote.id || null,
            name: local.game_username || local.game_uid,
            gameUid: local.game_uid,
            localJoinedAt: joinedAt,
            remoteJoinedAt: remote.joined_at || null
        });
    }

    return { plan, missingRemote, same, invalidLocalDate };
}

function buildPreviewEmbed({ guildId, includeLeft, userStats, pendingStats, applyResult = null }) {
    const userPlan = userStats.plan;
    const pendingPlan = pendingStats.plan;
    const totalPlan = userPlan.length + pendingPlan.length;
    const sample = [...userPlan, ...pendingPlan].slice(0, 12).map(item => {
        const prefix = item.type === 'pending' ? 'pending' : 'user';
        return `- ${prefix}: ${item.name} (${item.id}) ${formatDate(item.remoteJoinedAt)} -> ${formatDate(item.localJoinedAt)}`;
    });

    const isApply = !!applyResult;
    const embed = new EmbedBuilder()
        .setColor(isApply ? 0x2ECC71 : 0xF59E0B)
        .setTitle(isApply ? 'Da sync ngay vao len Supabase' : 'Preview sync ngay vao len Supabase')
        .setDescription([
            `Guild: \`${guildId || 'all'}\``,
            `Nguon dung: SQLite bot hien tai`,
            `Pham vi: ${includeLeft ? 'ca active + left' : 'chi active'}`,
            '',
            `bc_users se update: **${userPlan.length}**`,
            `bc_pending_ids se update: **${pendingPlan.length}**`,
            `Tong row se update: **${totalPlan}**`,
            '',
            `Users trung ngay: ${userStats.same} | khong co tren Supabase: ${userStats.missingRemote} | ngay local loi: ${userStats.invalidLocalDate}`,
            `Pending trung ngay: ${pendingStats.same} | khong co tren Supabase: ${pendingStats.missingRemote} | ngay local loi: ${pendingStats.invalidLocalDate}`
        ].join('\n'))
        .setTimestamp();

    if (sample.length > 0) {
        embed.addFields({ name: 'Mau thay doi', value: sample.join('\n').slice(0, 1000) });
    }

    if (isApply) {
        embed.addFields({
            name: 'Ket qua',
            value: [
                `bc_users updated: ${applyResult.usersUpdated}`,
                `bc_pending_ids updated: ${applyResult.pendingUpdated}`,
                `failed: ${applyResult.failed}`
            ].join('\n')
        });
    } else {
        embed.addFields({
            name: 'Chua ghi',
            value: 'Chay `?syncngayvao confirm` de ghi de rieng cot ngay vao tren Supabase.'
        });
    }

    return embed;
}

async function applyPlan(supabase, userPlan, pendingPlan, guildId) {
    const result = { usersUpdated: 0, pendingUpdated: 0, failed: 0 };

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

    return result;
}

async function execute(message, args) {
    if (!isAllowedGuildId(message.guild?.id)) return;

    if (!hasSyncPermission(message.member)) {
        return message.reply('Ban khong co quyen dung lenh nay. Yeu cau owner hoac role Quan Ly.');
    }

    const flags = new Set(args.map(arg => String(arg || '').toLowerCase()));
    const isConfirm = flags.has('confirm') || flags.has('xacnhan') || flags.has('run');
    const includeLeft = flags.has('all') || flags.has('includeleft') || flags.has('left');
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

        const localUsers = getLocalUsers(guildId, includeLeft);
        const localPending = getLocalPending(guildId);
        const userStats = buildUserPlan(localUsers, remoteUsers);
        const pendingStats = buildPendingPlan(localPending, remotePending);

        if (!isConfirm) {
            return message.channel.send({
                embeds: [buildPreviewEmbed({ guildId, includeLeft, userStats, pendingStats })]
            });
        }

        const applyResult = await applyPlan(supabase, userStats.plan, pendingStats.plan, guildId);

        void logMemberRosterAction(guildId, 'member_update', {
            summary: `Sync ngay vao len Supabase: ${applyResult.usersUpdated + applyResult.pendingUpdated} rows`,
            actor_id: message.author.id,
            actor_name: message.author.username,
            target_type: 'bulk',
            target_id: guildId,
            target_name: 'sync joined_at',
            changes: [
                { field: 'bc_users.joined_at', label: 'bc_users ngay vao', before: null, after: applyResult.usersUpdated },
                { field: 'bc_pending_ids.joined_at', label: 'pending ngay vao', before: null, after: applyResult.pendingUpdated }
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

        return message.channel.send({
            embeds: [buildPreviewEmbed({ guildId, includeLeft, userStats, pendingStats, applyResult })]
        });
    } catch (error) {
        console.error('[syncngayvao] failed:', error);
        return message.reply(`Co loi khi sync ngay vao: ${error.message}`);
    }
}

module.exports = { execute };
