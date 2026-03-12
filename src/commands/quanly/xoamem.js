/**
 * ?xoamem command - Xóa thành viên khỏi database
 * Usage: ?xoamem <@user|Discord ID|username>
 * 
 * Requires: BC, PBC hoặc KC (role Quản Lý hoặc Kỳ Cựu)
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

/**
 * Check if user has high-level role (BC, PBC, KC)
 */
function hasHighLevelRole(member) {
    return member.roles.cache.some(role =>
        role.name === 'Quản Lý' || role.name === 'Kỳ Cựu'
    );
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

    // If nothing found anywhere
    if (!existingUser && !pendingEntry) {
        return message.channel.send(`❌ Không tìm thấy trong database!\n💡 Thử: \`?xoamem <UID>\` hoặc \`?xoamem <Tên game>\``);
    }

    // Delete from database
    try {
        let deletedFrom = [];

        // Delete from users table
        if (existingUser) {
            db.db.prepare('DELETE FROM users WHERE discord_id = ?').run(targetDiscordId);
            deletedFrom.push('users');
        }

        // Delete from pending_ids table
        if (pendingEntry) {
            db.db.prepare('DELETE FROM pending_ids WHERE id = ?').run(pendingEntry.id);
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
