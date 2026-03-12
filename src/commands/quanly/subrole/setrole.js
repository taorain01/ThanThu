/**
 * ?setrole - Set sub-role for self or others
 * Usage:
 *   ?setrole <mã> - Kỳ Cựu+ tự set cho mình
 *   ?setrole <mã> @user - Bang Chủ set cho người khác
 * 
 * NOTE: setrole KHÔNG tự đổi display icon
 *   - User tự đổi display icon bằng ?role
 *   - setrole chỉ thêm role phụ vào Discord
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings, getSubRoleName, isForAll, DISPLAY_ROLE_NAME } = require('./addrole');

function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

function hasKcOrAbove(member) {
    return ['Bang Chủ', 'Phó Bang Chủ', 'Kỳ Cựu'].some(r => hasRole(member, r));
}

function findRole(guild, roleName) {
    return guild.roles.cache.find(r => r.name === roleName) || null;
}

/**
 * Tìm member bằng mention, username hoặc ID
 */
async function findMember(guild, identifier) {
    // Try mention first
    const mentionMatch = identifier.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        try {
            return await guild.members.fetch(mentionMatch[1]);
        } catch { return null; }
    }

    // Try ID
    if (/^\d{17,19}$/.test(identifier)) {
        try {
            return await guild.members.fetch(identifier);
        } catch { return null; }
    }

    // Try username (search với limit để tránh rate limit)
    try {
        const members = await guild.members.fetch({ query: identifier, limit: 10 });
        const lowerIdentifier = identifier.toLowerCase();
        return members.find(m =>
            m.user.username.toLowerCase() === lowerIdentifier ||
            m.displayName.toLowerCase() === lowerIdentifier
        ) || null;
    } catch (e) {
        console.error('[setrole] Error searching member:', e.message);
        return null;
    }
}

/**
 * Xóa tất cả display roles (tên ".") của user
 */
async function removeAllDisplayRoles(member) {
    const displayRoles = member.roles.cache.filter(r => r.name === DISPLAY_ROLE_NAME);
    for (const [, role] of displayRoles) {
        try {
            await member.roles.remove(role);
        } catch (e) {
            console.error('[setrole] Error removing display role:', e.message);
        }
    }
}

/**
 * Gán display role cho user
 */
async function assignDisplayRole(member, guildId, code) {
    // Lấy display role từ DB
    const displayRoleData = db.getDisplayRole(guildId, code);
    if (!displayRoleData || !displayRoleData.display_role_id) {
        console.log('[setrole] No display role found for code:', code);
        return false;
    }

    // Tìm role trên Discord
    const displayRole = member.guild.roles.cache.get(displayRoleData.display_role_id);
    if (!displayRole) {
        console.log('[setrole] Display role not found on Discord:', displayRoleData.display_role_id);
        return false;
    }

    // Xóa tất cả display roles cũ trước
    await removeAllDisplayRoles(member);

    // Gán display role mới
    try {
        await member.roles.add(displayRole);
        // Cập nhật user_display trong DB
        db.setUserDisplay(member.id, code);
        return true;
    } catch (e) {
        console.error('[setrole] Error assigning display role:', e.message);
        return false;
    }
}

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    try {
        console.log('[setrole] === START ===');
        console.log('[setrole] args:', JSON.stringify(args));

        const isOwner = message.author.id === OWNER_ID;

        // Parse args: first arg is code, rest could be user identifier
        const code = args[0]?.toLowerCase();
        const userIdentifier = args.slice(1).join(' ');

        // Try to find target member
        let targetMember = message.mentions.members.first();

        // If has userIdentifier but no mention, try to find by username/ID
        if (!targetMember && userIdentifier) {
            targetMember = await findMember(message.guild, userIdentifier);
        }

        const isSelfMention = targetMember && targetMember.id === message.author.id;

        // === Setting for others (Bang Chủ + Owner) ===
        if (targetMember && !isSelfMention) {
            if (!isOwner && !hasRole(message.member, 'Bang Chủ')) {
                return message.channel.send('❌ Chỉ **Bang Chủ** mới có thể set role cho người khác!');
            }

            if (!code) {
                return message.channel.send('❌ Thiếu mã role! Cách dùng: `?setrole <mã> @user` hoặc `?setrole <mã> <username/id>`');
            }

            const mappingEntry = getRoleMappings()[code];
            if (!mappingEntry) {
                return message.channel.send(`❌ Mã \`${code}\` không tồn tại! Dùng \`?dsrole\` để xem danh sách.`);
            }

            const roleName = typeof mappingEntry === 'string' ? mappingEntry : mappingEntry.name;
            const forAll = mappingEntry.forAll === true;

            // Check user validation based on forAll
            const userData = db.getUserByDiscordId(targetMember.id);
            if (!forAll && !userData) {
                return message.channel.send(`❌ ${targetMember} chưa có trong guild! Role \`${code}\` chỉ dành cho guild members.\nDùng \`?add\` để thêm họ trước.`);
            }

            // Save to database (nếu user có trong DB)
            if (userData) {
                db.setUserSubRole(targetMember.id, code);
            }

            // Assign Discord role
            let roleAssigned = false;
            const role = findRole(message.guild, roleName);
            if (role && !targetMember.roles.cache.has(role.id)) {
                try {
                    await targetMember.roles.add(role);
                    roleAssigned = true;
                } catch (e) {
                    console.error('[setrole] Error:', e.message);
                }
            } else if (role) {
                roleAssigned = true;
            }

            // KHÔNG đổi display icon - chỉ thêm role phụ
            // User có thể tự đổi display icon bằng ?role

            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('✅ Đã set Role phụ!')
                .setDescription(
                    `**User:** ${targetMember}\n` +
                    `**Role:** ${roleName}\n` +
                    `**Loại:** ${forAll ? '🌐 All server' : '👥 Guild only'}\n` +
                    `**Discord role:** ${roleAssigned ? '✅' : '⚠️ Chưa có role trên server'}\n\n` +
                    `💡 ${targetMember} có thể dùng \`?role\` để đổi icon hiển thị.`
                )
                .setFooter({ text: `Bởi ${message.author.username}` })
                .setTimestamp();

            return message.channel.send({ embeds: [embed] });
        }

        // === Self-setting ===
        if (!hasKcOrAbove(message.member)) {
            return message.channel.send('❌ Chỉ **Kỳ Cựu** trở lên mới được sử dụng lệnh này!');
        }

        // code is already defined from args[0] above
        if (!code) {
            const mappings = getRoleMappings();
            const list = Object.entries(mappings)
                .map(([c, e]) => {
                    const name = typeof e === 'string' ? e : e.name;
                    const badge = e.forAll ? '🌐' : '👥';
                    return `${badge} \`${c}\` → ${name}`;
                })
                .join('\n');

            return message.channel.send(
                '❌ Thiếu mã role!\nCách dùng: `?setrole <mã>`\n\n' +
                '**Danh sách:**\n' + (list || 'Chưa có')
            );
        }

        const mappingEntry = getRoleMappings()[code];
        if (!mappingEntry) {
            return message.channel.send(`❌ Mã \`${code}\` không tồn tại!`);
        }

        const roleName = typeof mappingEntry === 'string' ? mappingEntry : mappingEntry.name;
        const userId = message.author.id;

        // Check user in DB
        const userData = db.getUserByDiscordId(userId);
        if (!userData) {
            return message.channel.send('❌ Bạn chưa có trong database!');
        }

        // Save sub_role
        db.setUserSubRole(userId, code);

        // Assign Discord role
        let roleAssigned = false;
        const role = findRole(message.guild, roleName);
        if (role && !message.member.roles.cache.has(role.id)) {
            try {
                await message.member.roles.add(role);
                roleAssigned = true;
            } catch (e) {
                console.error('[setrole] Error:', e.message);
            }
        } else if (role) {
            roleAssigned = true;
        }

        // KHÔNG đổi display icon - user có thể dùng ?role để đổi

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('✅ Đã set Role phụ!')
            .setDescription(
                `**Role phụ:** ${roleName}\n` +
                `**Discord role:** ${roleAssigned ? '✅' : '⚠️ Chưa có role trên server'}\n\n` +
                `💡 Dùng \`?role\` để đổi icon hiển thị.\n` +
                `Dùng \`?mem\` để xem profile!`
            )
            .setFooter({ text: `Bởi ${message.author.username}` })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[setrole] Unexpected error:', error);
        return message.channel.send('❌ Đã xảy ra lỗi khi thực hiện lệnh!');
    }
}

module.exports = {
    execute,
    removeAllDisplayRoles,
    assignDisplayRole
};
