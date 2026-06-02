/**
 * ?xoamem command - Xóa thành viên khỏi database
 * Usage: ?xoamem <@user|Discord ID|username>
 * 
 * Requires: BC, PBC hoặc KC (role Quản Lý hoặc Kỳ Cựu)
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const memberRosterSync = require('../../utils/memberRosterSync');
const supaSync = require('../../utils/supabaseSync');

/**
 * Check if user has high-level role (BC, PBC, KC)
 */
function hasHighLevelRole(member) {
    return member.roles.cache.some(role =>
        role.name === 'Quản Lý' || role.name === 'Kỳ Cựu'
    );
}

function normalizeText(value = '') {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[đð]/g, 'd')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function rowMatchesSearch(row, searchTerm) {
    const raw = String(searchTerm || '').trim();
    const normalized = normalizeText(raw);
    if (!raw) return false;
    if (String(row.discord_id || '') === raw || String(row.game_uid || '') === raw) return true;

    const fields = [row.discord_name, row.game_username, row.game_uid]
        .filter(Boolean)
        .map((value) => String(value));
    return fields.some((value) => {
        const lower = value.toLowerCase();
        const fieldNormalized = normalizeText(value);
        return lower === raw.toLowerCase()
            || lower.includes(raw.toLowerCase())
            || fieldNormalized === normalized
            || (normalized && fieldNormalized.includes(normalized));
    });
}

async function findSupabaseUserBySearch(searchTerm, guildId = null) {
    if (!supaSync.isReady()) supaSync.initSupabase();
    const supabase = supaSync.getSupabaseClient();
    if (!supabase) return { error: new Error('Supabase chua san sang. Kiem tra SUPABASE_URL va SUPABASE_SERVICE_KEY.') };

    let query = supabase
        .from('bc_users')
        .select('discord_id,discord_name,game_username,game_uid,position,guild_id,lang_gia_member');
    if (guildId) query = query.eq('guild_id', guildId);

    const { data, error } = await query.range(0, 4999);
    if (error) return { error };

    const matches = (data || []).filter((row) => rowMatchesSearch(row, searchTerm));
    const normalized = normalizeText(searchTerm);
    const exact = matches.filter((row) =>
        String(row.discord_id || '') === String(searchTerm).trim()
        || normalizeText(row.discord_name) === normalized
        || normalizeText(row.game_username) === normalized
        || normalizeText(row.game_uid) === normalized
    );
    return { supabase, matches: exact.length === 1 ? exact : matches };
}

async function deleteSupabaseUserEverywhere(supabase, row) {
    const discordId = String(row?.discord_id || '').trim();
    const gameUid = String(row?.game_uid || '').trim();
    const gameUsername = String(row?.game_username || '').trim();
    const guildId = String(row?.guild_id || '').trim();
    const result = { bcUsers: 0, bcRegulars: 0, pending: 0 };

    if (discordId) {
        let usersQuery = supabase.from('bc_users').delete({ count: 'exact' }).eq('discord_id', discordId);
        if (guildId) usersQuery = usersQuery.eq('guild_id', guildId);
        const usersDelete = await usersQuery;
        if (usersDelete.error) throw usersDelete.error;
        result.bcUsers = usersDelete.count || 0;

        let regularQuery = supabase.from('bc_regulars').delete({ count: 'exact' }).eq('discord_id', discordId);
        if (guildId) regularQuery = regularQuery.eq('guild_id', guildId);
        const regularDelete = await regularQuery;
        if (regularDelete.error && !/schema cache|find the table|does not exist/i.test(regularDelete.error.message || '')) throw regularDelete.error;
        result.bcRegulars = regularDelete.count || 0;
    }

    if (gameUid) {
        let pendingByUidQuery = supabase.from('bc_pending_ids').delete({ count: 'exact' }).eq('game_uid', gameUid);
        if (guildId) pendingByUidQuery = pendingByUidQuery.eq('guild_id', guildId);
        const pendingByUid = await pendingByUidQuery;
        if (pendingByUid.error && !/schema cache|find the table|does not exist/i.test(pendingByUid.error.message || '')) throw pendingByUid.error;
        result.pending += pendingByUid.count || 0;
    }

    if (gameUsername) {
        let pendingByNameQuery = supabase.from('bc_pending_ids').delete({ count: 'exact' }).eq('game_username', gameUsername);
        if (guildId) pendingByNameQuery = pendingByNameQuery.eq('guild_id', guildId);
        const pendingByName = await pendingByNameQuery;
        if (pendingByName.error && !/schema cache|find the table|does not exist/i.test(pendingByName.error.message || '')) throw pendingByName.error;
        result.pending += pendingByName.count || 0;
    }

    return result;
}

async function execute(message, args) {
    // Permission check - only BC, PBC, KC
    if (!hasHighLevelRole(message.member)) {
        return message.channel.send('❌ Bạn không có quyền xóa thành viên! Yêu cầu role: **Quản Lý** hoặc **Kỳ Cựu**');
    }

    if (args.length < 1) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('📋 Hướng dẫn ?xoamem')
            .setDescription([
                '**Cú pháp:**',
                '```',
                '?xoamem <@user|Discord ID|username>',
                '```',
                '',
                '**Ví dụ:**',
                '• `?xoamem @rain` - Xóa thành viên rain',
                '• `?xoamem 732789174310273114` - Xóa bằng Discord ID',
                '• `?xoamem rainditua` - Xóa bằng username'
            ].join('\n'))
            .setFooter({ text: '⚠️ Lệnh này sẽ xóa hoàn toàn khỏi database, không phải đánh dấu rời guild' });

        return message.channel.send({ embeds: [embed] });
    }

    // ============ CHECK PENDING_IDS FIRST ============
    // (User might not be in Discord yet, only in pending list)
    let pendingEntry = null;
    const searchTerm = args.join(' ').replace(/[<@!>]/g, '').trim();
    const firstArg = args[0]?.replace(/[<@!>]/g, '');

    try {
        // Search pending_ids by UID (first arg) or name (full search term)
        pendingEntry = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? OR game_username = ? COLLATE NOCASE').get(firstArg, searchTerm);

        // If not found, try each arg individually
        if (!pendingEntry) {
            for (const arg of args) {
                const cleanArg = arg.replace(/[<@!>]/g, '');
                pendingEntry = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? OR game_username = ? COLLATE NOCASE').get(cleanArg, cleanArg);
                if (pendingEntry) break;
            }
        }
    } catch (e) { console.error('xoamem pending search error:', e); }

    // ============ CHECK DISCORD USER ============
    let targetUser = message.mentions.users.first();
    let targetDiscordId = null;
    let existingUser = null;

    if (!targetUser) {
        const userArg = args[0];

        // Try as Discord ID (snowflake)
        if (/^\d{17,20}$/.test(userArg)) {
            try {
                targetUser = await message.client.users.fetch(userArg);
                targetDiscordId = userArg;
            } catch (e) {
                targetDiscordId = userArg;
            }
        } else {
            // Try as username - search in guild members
            try {
                let foundMember = message.guild.members.cache.find(m =>
                    m.user.username.toLowerCase() === userArg.toLowerCase() ||
                    m.displayName?.toLowerCase() === userArg.toLowerCase()
                );
                if (!foundMember) {
                    const searchResults = await message.guild.members.search({ query: userArg, limit: 1 });
                    foundMember = searchResults.first();
                }
                if (foundMember) {
                    targetUser = foundMember.user;
                    targetDiscordId = foundMember.id;
                } else {
                    // Try to find in database by game name
                    const allUsers = db.getAllUsers();
                    const dbUser = allUsers.find(u =>
                        u.game_username?.toLowerCase() === userArg.toLowerCase() ||
                        u.discord_name?.toLowerCase() === userArg.toLowerCase()
                    );
                    if (dbUser) {
                        targetDiscordId = dbUser.discord_id;
                    }
                    // DON'T return error here - might still find in pending_ids
                }
            } catch (e) { /* ignore */ }
        }
    } else {
        targetDiscordId = targetUser.id;
    }

    // Check if user exists in users table
    if (targetDiscordId) {
        existingUser = db.getUserByDiscordId(targetDiscordId);
    }

    // If nothing found locally, try Supabase directly. Some old rows only exist there.
    if (!existingUser && !pendingEntry) {
        const remoteLookup = await findSupabaseUserBySearch(searchTerm, message.guild?.id);
        if (remoteLookup.error) {
            console.error('xoamem supabase search error:', remoteLookup.error);
            return message.channel.send(`❌ Không tìm thấy trong local database, Supabase cũng lỗi: ${remoteLookup.error.message || remoteLookup.error}`);
        }

        if (!remoteLookup.matches.length) {
            return message.channel.send(`❌ Không tìm thấy trong database!\n💡 Thử: \`?xoamem <UID>\` hoặc \`?xoamem <Tên game>\``);
        }

        if (remoteLookup.matches.length > 1) {
            const lines = remoteLookup.matches.slice(0, 10).map((row, index) => {
                const discord = row.discord_id || 'N/A';
                const gameName = row.game_username || 'N/A';
                const discordName = row.discord_name || 'N/A';
                return `${index + 1}. ${gameName} | Discord: ${discordName} (${discord})`;
            });
            const more = remoteLookup.matches.length > 10 ? `\n... và ${remoteLookup.matches.length - 10} kết quả khác` : '';
            return message.channel.send([
                '⚠️ Tìm thấy nhiều dòng Supabase khớp. Hãy chạy lại bằng Discord ID hoặc tên chính xác:',
                '```',
                lines.join('\n') + more,
                '```'
            ].join('\n'));
        }

        const remoteRow = remoteLookup.matches[0];
        try {
            const deleted = await deleteSupabaseUserEverywhere(remoteLookup.supabase, remoteRow);
            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🗑️ Đã xóa member Supabase-only!')
                .addFields(
                    { name: '👤 Discord', value: remoteRow.discord_name || remoteRow.discord_id || 'N/A', inline: true },
                    { name: '🎮 Tên Game', value: remoteRow.game_username || 'N/A', inline: true },
                    { name: '🆔 UID', value: remoteRow.game_uid || 'N/A', inline: true },
                    { name: '📋 Xóa từ', value: `bc_users: ${deleted.bcUsers}, bc_regulars: ${deleted.bcRegulars}, pending: ${deleted.pending}`, inline: false }
                )
                .setFooter({ text: `Xóa bởi ${message.author.username}` })
                .setTimestamp();

            return message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('xoamem supabase delete error:', error);
            return message.channel.send(`❌ Có lỗi khi xóa trên Supabase: ${error.message || error}`);
        }
    }

    // Delete from database
    try {
        let deletedFrom = [];

        // Delete from users table
        if (existingUser) {
            db.db.prepare('DELETE FROM users WHERE discord_id = ?').run(targetDiscordId);
            await memberRosterSync.deleteUserFromSupabase(targetDiscordId);
            deletedFrom.push('users');
        }

        // Delete from pending_ids table
        if (pendingEntry) {
            db.db.prepare('DELETE FROM pending_ids WHERE id = ?').run(pendingEntry.id);
            await memberRosterSync.deletePendingFromSupabase(pendingEntry.game_uid, message.guild?.id);
            deletedFrom.push('pending_ids');
        }

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🗑️ Đã xóa thành viên!')
            .addFields(
                { name: '👤 Discord', value: targetUser ? `<@${targetDiscordId}>` : (existingUser ? `ID: ${targetDiscordId}` : 'N/A'), inline: true },
                { name: '🎮 Tên Game', value: existingUser?.game_username || pendingEntry?.game_username || 'N/A', inline: true },
                { name: '🆔 UID', value: existingUser?.game_uid || pendingEntry?.game_uid || 'N/A', inline: true },
                { name: '📋 Xóa từ', value: deletedFrom.join(', '), inline: true }
            )
            .setFooter({ text: `Xóa bởi ${message.author.username}` })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Error deleting member:', error);
        await message.channel.send('❌ Có lỗi xảy ra khi xóa thành viên!');
    }
}

module.exports = { execute };
