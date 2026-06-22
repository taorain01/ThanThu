const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const supaSync = require('../../utils/supabaseSync');
const { logMemberRosterAction } = require('../../utils/memberRosterLog');
const { ALLOWED_GUILD_ID, isAllowedGuildId } = require('../../config/guildAccess');
const { cleanupAlbumForUser } = require('../../utils/albumCleanup');

const OWNER_IDS = new Set(['395151484179841024', '1247475535317422111']);
const CHUNK_SIZE = 400;

function hasCleanupPermission(member) {
    return OWNER_IDS.has(member?.id) || member?.roles?.cache?.some(role => normalizeText(role.name) === 'quan ly');
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isLeftRemoteUser(row) {
    return ['khong co', 'left', 'out'].includes(normalizeText(row?.position));
}

function chunk(values, size = CHUNK_SIZE) {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
        chunks.push(values.slice(i, i + size));
    }
    return chunks;
}

function placeholders(count) {
    return Array.from({ length: count }, () => '?').join(',');
}

function formatUser(row) {
    const name = row.game_username || row.discord_name || row.discord_id || row.game_uid || 'unknown';
    const guild = row.guild_id ? ` guild:${row.guild_id}` : '';
    return `${name} (${row.discord_id || row.game_uid || row.id})${guild}`;
}

async function getMainGuild(message) {
    const guild = message.client.guilds.cache.get(ALLOWED_GUILD_ID) || message.guild;
    if (!guild || !isAllowedGuildId(guild.id)) return null;
    await guild.members.fetch();
    return guild;
}

function getLocalPlan(memberIds) {
    const users = db.db.prepare('SELECT * FROM users ORDER BY discord_name ASC').all();
    const leftLocalIds = new Set();
    const deleteUsers = [];

    for (const user of users) {
        if (user.left_at) {
            leftLocalIds.add(String(user.discord_id));
            continue;
        }

        const reasons = [];
        if (user.guild_id && user.guild_id !== ALLOWED_GUILD_ID) reasons.push('add_from_other_server');
        if (!memberIds.has(String(user.discord_id))) reasons.push('not_in_main_server');

        if (reasons.length > 0) {
            deleteUsers.push({ ...user, reasons });
        }
    }

    let pendingRows = [];
    try {
        pendingRows = db.db.prepare(`
            SELECT * FROM pending_ids
            WHERE guild_id IS NOT NULL AND guild_id <> ?
            ORDER BY added_at DESC
        `).all(ALLOWED_GUILD_ID);
    } catch (error) {
        pendingRows = [];
    }

    return {
        users,
        leftLocalIds,
        deleteUsers,
        deletePending: pendingRows
    };
}

async function getSupabasePlan(memberIds, localDeleteIds, leftLocalIds) {
    if (!supaSync.isReady()) {
        supaSync.initSupabase();
    }

    const supabase = supaSync.getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase chua san sang. Kiem tra SUPABASE_URL va SUPABASE_SERVICE_KEY.');
    }

    const { data: remoteUsers, error } = await supabase
        .from('bc_users')
        .select('discord_id, discord_name, game_username, game_uid, position, guild_id, lang_gia_member');

    if (error) throw new Error(`Khong doc duoc bc_users: ${error.message}`);

    const deleteUsers = [];
    for (const row of remoteUsers || []) {
        const discordId = String(row.discord_id || '');
        if (!discordId) continue;
        const reasons = [];
        if (row.guild_id && row.guild_id !== ALLOWED_GUILD_ID) reasons.push('supabase_other_server');
        if (!memberIds.has(discordId)) reasons.push('supabase_not_in_main_server');
        if (localDeleteIds.has(discordId)) reasons.push('matched_local_delete');
        if (!memberIds.has(discordId) && leftLocalIds.has(discordId)) reasons.push('local_marked_left');
        if (!memberIds.has(discordId) && isLeftRemoteUser(row)) reasons.push('remote_marked_left');

        if (reasons.length > 0) {
            deleteUsers.push({ ...row, reasons });
        }
    }

    return {
        supabase,
        remoteUsers: remoteUsers || [],
        deleteUsers
    };
}

function deleteLocalRows(deleteUsers, deletePending) {
    const userIds = deleteUsers.map(row => String(row.discord_id));
    const pendingIds = deletePending.map(row => row.id);

    const result = {
        users: 0,
        pending: 0,
        userDisplay: 0,
        bcRegular: 0,
        otherGuildBcRegular: 0
    };

    const transaction = db.db.transaction(() => {
        for (const batch of chunk(userIds)) {
            if (batch.length === 0) continue;
            const ph = placeholders(batch.length);
            result.userDisplay += db.db.prepare(`DELETE FROM user_display WHERE discord_id IN (${ph})`).run(...batch).changes;
            result.bcRegular += db.db.prepare(`DELETE FROM bc_regular WHERE discord_id IN (${ph})`).run(...batch).changes;
            result.users += db.db.prepare(`DELETE FROM users WHERE discord_id IN (${ph})`).run(...batch).changes;
        }

        for (const batch of chunk(pendingIds)) {
            if (batch.length === 0) continue;
            const ph = placeholders(batch.length);
            result.pending += db.db.prepare(`DELETE FROM pending_ids WHERE id IN (${ph})`).run(...batch).changes;
        }

        try {
            result.otherGuildBcRegular += db.db.prepare(`
                DELETE FROM bc_regular
                WHERE guild_id IS NOT NULL AND guild_id <> ?
            `).run(ALLOWED_GUILD_ID).changes;
        } catch (error) {
            result.otherGuildBcRegular = 0;
        }
    });

    transaction();
    return result;
}

function getAlbumCleanupIds(localPlan, supabasePlan) {
    return new Set([
        ...localPlan.deleteUsers.map(row => String(row.discord_id || '')).filter(Boolean),
        ...Array.from(localPlan.leftLocalIds || []).map(id => String(id || '')).filter(Boolean),
        ...supabasePlan.deleteUsers.map(row => String(row.discord_id || '')).filter(Boolean)
    ]);
}

function countAlbumImagesForIds(userIds) {
    const ids = Array.from(userIds || []).filter(Boolean);
    let count = 0;
    for (const batch of chunk(ids)) {
        if (batch.length === 0) continue;
        const ph = placeholders(batch.length);
        const row = db.db.prepare(`SELECT COUNT(*) as count FROM album WHERE user_id IN (${ph})`).get(...batch);
        count += row?.count || 0;
    }
    return count;
}

async function cleanupAlbumsForIds(userIds, reason, client = null, guildId = null) {
    const result = { users: 0, images: 0, cloudinaryDeleted: 0, cloudinaryFailed: 0, discordMessagesDeleted: 0, discordMessagesFailed: 0 };
    for (const userId of userIds) {
        const cleanup = await cleanupAlbumForUser(userId, reason, { client, guildId });
        if (cleanup.deleted > 0 || cleanup.cloudinaryDeleted > 0 || cleanup.cloudinaryFailed > 0 || cleanup.discordMessagesDeleted > 0 || cleanup.discordMessagesFailed > 0) {
            result.users++;
        }
        result.images += cleanup.deleted;
        result.cloudinaryDeleted += cleanup.cloudinaryDeleted;
        result.cloudinaryFailed += cleanup.cloudinaryFailed;
        result.discordMessagesDeleted += cleanup.discordMessagesDeleted;
        result.discordMessagesFailed += cleanup.discordMessagesFailed;
    }
    return result;
}

async function deleteSupabaseRows(supabase, deleteUsers) {
    const userIds = [...new Set(deleteUsers.map(row => String(row.discord_id)).filter(Boolean))];
    const result = {
        bcUsers: 0,
        bcRegularByUser: 0,
        bcRegularOtherGuild: 0
    };

    for (const batch of chunk(userIds)) {
        const usersDelete = await supabase
            .from('bc_users')
            .delete({ count: 'exact' })
            .in('discord_id', batch);
        if (usersDelete.error) throw new Error(`Xoa bc_users loi: ${usersDelete.error.message}`);
        result.bcUsers += usersDelete.count || 0;

        const regularDelete = await supabase
            .from('bc_regulars')
            .delete({ count: 'exact' })
            .in('discord_id', batch);
        if (regularDelete.error && !/schema cache|find the table|does not exist/i.test(regularDelete.error.message || '')) {
            throw new Error(`Xoa bc_regulars theo user loi: ${regularDelete.error.message}`);
        }
        result.bcRegularByUser += regularDelete.count || 0;
    }

    const otherRegularDelete = await supabase
        .from('bc_regulars')
        .delete({ count: 'exact' })
        .neq('guild_id', ALLOWED_GUILD_ID);
    if (otherRegularDelete.error && !/schema cache|find the table|does not exist/i.test(otherRegularDelete.error.message || '')) {
        throw new Error(`Xoa bc_regulars server khac loi: ${otherRegularDelete.error.message}`);
    }
    result.bcRegularOtherGuild = otherRegularDelete.count || 0;

    return result;
}

function buildPreviewEmbed({ guild, localPlan, supabasePlan, isConfirm, localResult = null, supabaseResult = null, albumCleanupImageCount = 0, albumCleanupResult = null }) {
    const sample = [
        ...localPlan.deleteUsers.slice(0, 8).map(row => `- SQLite: ${formatUser(row)} [${row.reasons.join(', ')}]`),
        ...supabasePlan.deleteUsers.slice(0, 8).map(row => `- Supabase: ${formatUser(row)} [${row.reasons.join(', ')}]`),
        ...localPlan.deletePending.slice(0, 4).map(row => `- pending_ids: ${row.game_username || row.game_uid} guild:${row.guild_id}`)
    ].slice(0, 10);

    const embed = new EmbedBuilder()
        .setColor(isConfirm ? 0xE74C3C : 0xF59E0B)
        .setTitle(isConfirm ? 'Da don mem ngoai server' : 'Preview don mem ngoai server')
        .setDescription([
            `Server chuan: \`${ALLOWED_GUILD_ID}\``,
            `Discord members fetch: **${guild.memberCount || guild.members.cache.size}**`,
            '',
            `SQLite users se xoa: **${localPlan.deleteUsers.length}**`,
            `SQLite pending_ids server khac se xoa: **${localPlan.deletePending.length}**`,
            `SQLite roiguild/left_at giu lai: **${localPlan.leftLocalIds.size}**`,
            `Supabase bc_users se xoa: **${supabasePlan.deleteUsers.length}**`,
            `Album phong anh se xoa: **${albumCleanupImageCount}** anh`
        ].join('\n'))
        .setTimestamp();

    if (sample.length > 0) {
        embed.addFields({
            name: 'Mau se xoa',
            value: sample.join('\n').slice(0, 1000)
        });
    }

    if (!isConfirm) {
        embed.addFields({
            name: 'Chua xoa',
            value: 'Chay `?xoamemngoaiserver confirm` de xoa that.'
        });
        return embed;
    }

    embed.addFields(
        {
            name: 'SQLite da xoa',
            value: [
                `users: ${localResult.users}`,
                `pending_ids: ${localResult.pending}`,
                `user_display: ${localResult.userDisplay}`,
                `bc_regular theo user: ${localResult.bcRegular}`,
                `bc_regular server khac: ${localResult.otherGuildBcRegular}`
            ].join('\n'),
            inline: true
        },
        {
            name: 'Supabase da xoa',
            value: [
                `bc_users: ${supabaseResult.bcUsers}`,
                `bc_regulars theo user: ${supabaseResult.bcRegularByUser}`,
                `bc_regulars server khac: ${supabaseResult.bcRegularOtherGuild}`
            ].join('\n'),
            inline: true
        },
        {
            name: 'Album da xoa',
            value: [
                `users co album: ${albumCleanupResult?.users || 0}`,
                `anh DB: ${albumCleanupResult?.images || 0}`,
                `Cloudinary: ${albumCleanupResult?.cloudinaryDeleted || 0}`,
                `Cloudinary loi: ${albumCleanupResult?.cloudinaryFailed || 0}`,
                `Discord msg: ${albumCleanupResult?.discordMessagesDeleted || 0}`,
                `Discord msg loi: ${albumCleanupResult?.discordMessagesFailed || 0}`
            ].join('\n'),
            inline: true
        }
    );

    return embed;
}

async function execute(message, args) {
    if (message.guild?.id !== ALLOWED_GUILD_ID) return;

    if (!hasCleanupPermission(message.member)) {
        return message.reply('Ban khong co quyen dung lenh nay. Yeu cau owner hoac role Quan Ly.');
    }

    const isConfirm = ['confirm', 'xacnhan', 'run'].includes(String(args[0] || '').toLowerCase());
    const guild = await getMainGuild(message);
    if (!guild) return message.reply('Khong tim thay server chuan de doi chieu.');

    const memberIds = new Set(guild.members.cache.map(member => String(member.id)));
    const localPlan = getLocalPlan(memberIds);
    const localDeleteIds = new Set(localPlan.deleteUsers.map(row => String(row.discord_id)));
    let supabasePlan;

    try {
        supabasePlan = await getSupabasePlan(memberIds, localDeleteIds, localPlan.leftLocalIds);
    } catch (error) {
        return message.reply(`Khong lap duoc plan Supabase: ${error.message}`);
    }
    const albumCleanupIds = getAlbumCleanupIds(localPlan, supabasePlan);
    const albumCleanupImageCount = countAlbumImagesForIds(albumCleanupIds);

    if (!isConfirm) {
        return message.channel.send({
            embeds: [buildPreviewEmbed({ guild, localPlan, supabasePlan, isConfirm: false, albumCleanupImageCount })]
        });
    }

    try {
        const albumCleanupResult = await cleanupAlbumsForIds(albumCleanupIds, 'xoamemngoaiserver', message.client, message.guild.id);
        const localResult = deleteLocalRows(localPlan.deleteUsers, localPlan.deletePending);
        const supabaseResult = await deleteSupabaseRows(supabasePlan.supabase, supabasePlan.deleteUsers);
        void logMemberRosterAction(ALLOWED_GUILD_ID, 'member_bulk_cleanup', {
            summary: `Don mem ngoai server: ${localResult.users + supabaseResult.bcUsers} users`,
            actor_id: message.author.id,
            actor_name: message.author.username,
            target_type: 'bulk',
            target_id: ALLOWED_GUILD_ID,
            target_name: 'member cleanup',
            changes: [
                { field: 'local_users', label: 'SQLite users', before: null, after: localResult.users },
                { field: 'local_pending', label: 'SQLite pending', before: null, after: localResult.pending },
                { field: 'supabase_users', label: 'Supabase users', before: null, after: supabaseResult.bcUsers },
                { field: 'album_images', label: 'Album images', before: albumCleanupImageCount, after: albumCleanupResult.images }
            ],
            counts: {
                local_users: localResult.users,
                local_pending: localResult.pending,
                supabase_users: supabaseResult.bcUsers,
                supabase_regulars: supabaseResult.bcRegularByUser + supabaseResult.bcRegularOtherGuild,
                album_images: albumCleanupResult.images,
                album_cloudinary_deleted: albumCleanupResult.cloudinaryDeleted,
                album_cloudinary_failed: albumCleanupResult.cloudinaryFailed,
                album_discord_messages_deleted: albumCleanupResult.discordMessagesDeleted,
                album_discord_messages_failed: albumCleanupResult.discordMessagesFailed
            },
            targets: [
                ...localPlan.deleteUsers.slice(0, 10),
                ...supabasePlan.deleteUsers.slice(0, 10)
            ].slice(0, 20).map(row => ({
                discord_id: row.discord_id || null,
                game_username: row.game_username || null,
                game_uid: row.game_uid || null,
                reasons: row.reasons || []
            }))
        }, message.author.id);

        return message.channel.send({
            embeds: [buildPreviewEmbed({ guild, localPlan, supabasePlan, isConfirm: true, localResult, supabaseResult, albumCleanupImageCount, albumCleanupResult })]
        });
    } catch (error) {
        console.error('[xoamemngoaiserver] Cleanup failed:', error);
        return message.reply(`Co loi khi don data: ${error.message}`);
    }
}

module.exports = { execute };
