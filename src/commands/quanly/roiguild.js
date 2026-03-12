/**
 * ?roiguild / ?outguild command - Mark member as left guild
 * Usage: ?roiguild <@user|Discord ID|username|game name|UID> [Xnt]
 * 
 * - Works with users in database OR pending_ids (listid)
 * - Changes position to "Khong co" and sets left_at timestamp
 * - Removes from pending_ids if found there
 * - Removes LangGia role from Discord member
 * - Optional: Xnt = X days ago (e.g., 12nt = 12 days ago)
 * 
 * Requires: Ky Cu role
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

const LANG_GIA_ROLE_NAME = 'LangGia';

/**
 * Check if user has Ky Cu role
 */
function hasKcRole(member) {
    return member.roles.cache.some(role => role.name === 'Quản Lý' || role.name === 'Kỳ Cựu');
}

/**
 * Parse left date from "Xnt" format
 */
function parseLeftDate(arg) {
    if (!arg) return null;
    const match = arg.toLowerCase().match(/^(\d+)nt$/);
    if (match) {
        const daysAgo = parseInt(match[1]);
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date;
    }
    return null;
}

/**
 * Execute roiguild command
 */
async function execute(message, args) {
    // Check permission - requires Ky Cu role
    if (!hasKcRole(message.member)) {
        return message.channel.send('❌ Ban khong co quyen! Yeu cau role: **Quan Ly** hoac **Ky Cu**');
    }

    if (args.length < 1) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('Huong dan ?roiguild')
            .setDescription([
                '**Cu phap:**',
                '```',
                '?roiguild <@user|Discord ID|ten|UID> [Xnt]',
                '```',
                '',
                '**Vi du:**',
                '- `?roiguild @rain` - Danh dau rain roi guild',
                '- `?roiguild 732789174310273114` - Bang Discord ID',
                '- `?roiguild rainditua` - Bang ten Discord/game',
                '- `?roiguild 123456` - Bang UID tu listid',
                '- `?roiguild @rain 12nt` - Roi 12 ngay truoc'
            ].join('\n'));
        return message.channel.send({ embeds: [embed] });
    }

    // ============ PARSE DATE ARGUMENT ============
    let leftDate = new Date();
    for (const arg of args) {
        const parsedDate = parseLeftDate(arg);
        if (parsedDate) {
            leftDate = parsedDate;
            break;
        }
    }

    // ============ SEARCH PENDING_IDS FIRST ============
    let pendingEntry = null;
    const searchTerm = args.filter(a => !parseLeftDate(a)).join(' ').replace(/[<@!>]/g, '').trim();
    const firstArg = args[0]?.replace(/[<@!>]/g, '');

    try {
        // Search by UID or game name
        pendingEntry = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? OR game_username = ? COLLATE NOCASE').get(firstArg, searchTerm);

        if (!pendingEntry) {
            for (const arg of args) {
                if (parseLeftDate(arg)) continue;
                const cleanArg = arg.replace(/[<@!>]/g, '');
                pendingEntry = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? OR game_username = ? COLLATE NOCASE').get(cleanArg, cleanArg);
                if (pendingEntry) break;
            }
        }
    } catch (e) { /* ignore */ }

    // ============ SEARCH DISCORD USER ============
    let targetUser = message.mentions.users.first();
    let targetDiscordId = null;
    let userData = null;

    if (!targetUser) {
        const userArg = args[0];

        // Try as Discord ID
        if (/^\d{17,20}$/.test(userArg)) {
            try {
                targetUser = await message.client.users.fetch(userArg);
                targetDiscordId = userArg;
            } catch (e) {
                targetDiscordId = userArg;
            }
        } else if (/^\d+$/.test(userArg)) {
            // Try as game UID
            const dbUser = db.getUserByGameUid(userArg);
            if (dbUser) {
                targetDiscordId = dbUser.discord_id;
            }
        }

        if (!targetDiscordId) {
            // Try as username
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
                    // Try to find in database by game name or UID (redundant but safe)
                    const allUsers = db.getAllUsers();
                    const dbUser = allUsers.find(u =>
                        u.game_username?.toLowerCase() === userArg.toLowerCase() ||
                        u.discord_name?.toLowerCase() === userArg.toLowerCase() ||
                        u.game_uid === userArg
                    );
                    if (dbUser) {
                        targetDiscordId = dbUser.discord_id;
                    }
                }
            } catch (e) { /* ignore */ }
        }
    } else {
        targetDiscordId = targetUser.id;
    }

    // Get user data from database
    if (targetDiscordId) {
        userData = db.getUserByDiscordId(targetDiscordId);
    }

    // ============ HANDLE PENDING_IDS ENTRY ============
    if (pendingEntry && !userData) {
        // User only in pending_ids - ADD to users table with left_at flag, then remove from pending_ids
        try {
            // Insert into users table as left member
            const joinedAt = pendingEntry.joined_at || leftDate.toISOString();
            db.db.prepare(`
                INSERT OR REPLACE INTO users (discord_id, discord_name, game_username, game_uid, position, joined_at, left_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                'pending_' + pendingEntry.game_uid, // Fake discord_id since they don't have Discord
                pendingEntry.game_username,
                pendingEntry.game_username,
                pendingEntry.game_uid,
                'mem',
                joinedAt,
                leftDate.toISOString()
            );

            // Remove from pending_ids
            db.db.prepare('DELETE FROM pending_ids WHERE id = ?').run(pendingEntry.id);

            const embed = new EmbedBuilder()
                .setColor(0x808080)
                .setTitle('Da danh dau roi guild (tu listid)')
                .addFields(
                    { name: 'Ten Game', value: pendingEntry.game_username || 'N/A', inline: true },
                    { name: 'UID', value: pendingEntry.game_uid || 'N/A', inline: true },
                    { name: 'Ngay roi', value: `<t:${Math.floor(leftDate.getTime() / 1000)}:D>`, inline: true }
                )
                .setFooter({ text: `Danh dau boi ${message.author.username} - Da them vao listallmem` })
                .setTimestamp();

            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            console.error('roiguild pending delete error:', e);
            return message.channel.send('Co loi xay ra!');
        }
    }

    // ============ HANDLE DATABASE USER ============
    if (!userData) {
        return message.channel.send('Khong tim thay user! Thu: `?roiguild <@user>` hoac `?roiguild <UID>`');
    }

    // Check if already marked as left
    if (userData.left_at) {
        const existingLeftDate = new Date(userData.left_at);
        return message.channel.send(`User nay da duoc danh dau roi guild vao <t:${Math.floor(existingLeftDate.getTime() / 1000)}:D>`);
    }

    // Also delete from pending_ids if exists
    if (pendingEntry) {
        try {
            db.db.prepare('DELETE FROM pending_ids WHERE id = ?').run(pendingEntry.id);
        } catch (e) { /* ignore */ }
    }

    // Mark user as left
    const result = db.markUserAsLeft(targetDiscordId, leftDate.toISOString());

    // === XÓA KHỎI HỆ THỐNG BANG CHIẾN ===
    // 1. Xóa "Luôn tham gia" cho cả 2 ngày
    db.removeBcRegular(message.guild.id, targetDiscordId, 'sat');
    db.removeBcRegular(message.guild.id, targetDiscordId, 'sun');

    // 2. Xóa khỏi tất cả session BC active
    const activeSessions = db.getActiveBangchienByGuild(message.guild.id);
    for (const session of activeSessions) {
        db.removeBangchienParticipant(session.party_key, targetDiscordId);
    }

    // 3. Xóa role Bang Chiến 30vs30 + LangGia
    let roleRemoved = false;
    let bcRoleRemoved = false;
    try {
        const member = await message.guild.members.fetch(targetDiscordId).catch(() => null);
        if (member) {
            const langGiaRole = message.guild.roles.cache.find(r => r.name === LANG_GIA_ROLE_NAME);
            if (langGiaRole && member.roles.cache.has(langGiaRole.id)) {
                await member.roles.remove(langGiaRole);
                roleRemoved = true;
            }
            const bcRole = message.guild.roles.cache.find(r => r.name === 'Bang Chiến 30vs30');
            if (bcRole && member.roles.cache.has(bcRole.id)) {
                await member.roles.remove(bcRole);
                bcRoleRemoved = true;
            }
        }
    } catch (e) {
        console.error('[roiguild] Loi xoa role:', e.message);
    }

    if (result.success) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('👋 Đã đánh dấu rời guild')
            .setDescription(`**${userData.discord_name}** (<@${targetDiscordId}>) đã rời Lang Gia`)
            .addFields(
                { name: 'Tên Game', value: userData.game_username || 'N/A', inline: true },
                { name: 'UID', value: userData.game_uid || 'N/A', inline: true },
                { name: 'Ngày rời', value: `<t:${Math.floor(leftDate.getTime() / 1000)}:D>`, inline: true },
                { name: 'Role LangGia', value: roleRemoved ? '🔴 Đã xóa' : '⚪ Không có/Không thể xóa', inline: true }
            )
            .setFooter({ text: `Đánh dấu bởi ${message.author.username}` })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    } else {
        await message.channel.send('❌ Có lỗi xảy ra khi đánh dấu thành viên rời guild!');
    }
}

module.exports = {
    name: 'roiguild',
    aliases: ['outguild', 'leftguild'],
    description: 'Đánh dấu thành viên rời guild và xóa role LangGia',
    execute
};
