/**
 * ?addmem command - Add member to Lang Gia guild
 * Usage: ?addmem @user <position> <game_uid> <game_name> [Xnt]
 * 
 * Positions:
 * - bc (Bang Chủ) - requires "Quản Lý" role, unique
 * - pbc (Phó Bang Chủ) - requires "Quản Lý" role, unique
 * - kc (Kỳ Cựu) - requires "Kỳ Cựu" role
 * - mem (Thành Viên) - anyone can add
 * 
 * Join date:
 * - Xnt = X days ago (e.g. 19nt = 19 days ago)
 * - If not specified, uses today's date
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

// Position display names with emojis
const POSITION_CONFIG = {
    bc: { name: 'Bang Chủ', emoji: '👑', color: 0xFF0000 },
    pbc: { name: 'Phó Bang Chủ', emoji: '⚔️', color: 0xFF8800 },
    kc: { name: 'Kỳ Cựu', emoji: '🏆', color: 0x9B59B6 },
    mem: { name: 'Thành Viên', emoji: '👤', color: 0x3498DB }
};

// Unique positions (only 1 person allowed)
const UNIQUE_POSITIONS = ['bc', 'pbc'];

// Required role for each position
const REQUIRED_ROLES = {
    bc: 'Quản Lý',
    pbc: 'Quản Lý',
    kc: 'Kỳ Cựu'
    // mem: anyone can add
};

/**
 * Check if user has required role
 * @param {GuildMember} member - Discord member
 * @param {string} roleName - Required role name
 * @returns {boolean}
 */
function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

/**
 * Parse join date from "Xnt" format
 * @param {string} arg - Argument like "19nt"
 * @returns {Date|null} Date object or null if invalid
 */
function parseJoinDate(arg) {
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
 * Check if position is valid (kc variation or standard)
 * @param {string} position - Position to check
 * @returns {Object} { valid: boolean, normalizedPosition: string, isKcVariant: boolean }
 */
function validatePosition(position) {
    const pos = position.toLowerCase();

    // Standard positions
    if (POSITION_CONFIG[pos]) {
        return { valid: true, normalizedPosition: pos, isKcVariant: false };
    }

    // Check if it's a custom kc name
    const customKcNames = db.getCustomKcNames();
    if (customKcNames.includes(pos)) {
        return { valid: true, normalizedPosition: pos, isKcVariant: true };
    }

    return { valid: false, normalizedPosition: null, isKcVariant: false };
}

/**
 * Get position display info
 * @param {string} position - Position code
 * @returns {Object} { name, emoji, color }
 */
function getPositionDisplay(position) {
    const pos = position.toLowerCase();
    if (POSITION_CONFIG[pos]) {
        return POSITION_CONFIG[pos];
    }
    // Custom kc variant - use kc style
    return { name: pos.toUpperCase(), emoji: '🏆', color: 0x9B59B6 };
}

/**
 * Check if user has high-level role (BC, PBC, KC)
 * @param {GuildMember} member - Discord member
 * @returns {boolean}
 */
function hasHighLevelRole(member) {
    return hasRole(member, 'Quản Lý') || hasRole(member, 'Kỳ Cựu');
}

/**
 * Check if user has KC role (for editing)
 * @param {GuildMember} member - Discord member
 * @returns {boolean}
 */
function hasKcRole(member) {
    return hasRole(member, 'Quản Lý') || hasRole(member, 'Kỳ Cựu');
}

/**
 * Handle edit mode when user already exists
 * @param {Message} message - Discord message
 * @param {User} targetUser - Target Discord user
 * @param {Object} existingUser - Existing user data from database
 * @param {Object} newData - New data to update
 */
async function handleEditMode(message, targetUser, existingUser, newData) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

    // Permission check - only KC
    if (!hasKcRole(message.member)) {
        return message.channel.send('❌ Chỉ KC (Kỳ Cựu) mới có quyền chỉnh sửa thông tin thành viên!');
    }

    // Determine what fields are being changed
    const changes = [];
    const updates = {};

    if (newData.gameUid && newData.gameUid !== existingUser.game_uid) {
        // Check if new UID already belongs to another user
        const uidOwner = db.getUserByGameUid(newData.gameUid);
        if (uidOwner && uidOwner.discord_id !== targetUser.id) {
            return message.channel.send(`❌ UID \`${newData.gameUid}\` đã thuộc về <@${uidOwner.discord_id}>!`);
        }
        changes.push(`UID: \`${existingUser.game_uid}\` → \`${newData.gameUid}\``);
        updates.gameUid = newData.gameUid;
    }

    if (newData.gameName && newData.gameName !== existingUser.game_username) {
        changes.push(`Tên: \`${existingUser.game_username}\` → \`${newData.gameName}\``);
        updates.gameUsername = newData.gameName;
    }

    if (newData.joinDate) {
        const existingDate = new Date(existingUser.joined_at);
        const newDateStr = newData.joinDate.toISOString();
        if (newDateStr !== existingUser.joined_at) {
            changes.push(`Ngày join: <t:${Math.floor(existingDate.getTime() / 1000)}:D> → <t:${Math.floor(newData.joinDate.getTime() / 1000)}:D>`);
            updates.joinedAt = newDateStr;
        }
    }

    if (newData.normalizedPosition && newData.normalizedPosition !== existingUser.position) {
        // Check unique positions
        if (['bc', 'pbc'].includes(newData.normalizedPosition)) {
            const holder = db.getUniquePositionHolder(newData.normalizedPosition);
            if (holder && holder.discord_id !== targetUser.id) {
                return message.channel.send(`❌ ${newData.normalizedPosition.toUpperCase()} đã tồn tại: <@${holder.discord_id}>`);
            }
        }

        const oldPos = getPositionDisplay(existingUser.position);
        const newPos = getPositionDisplay(newData.normalizedPosition);
        changes.push(`Chức vụ: ${oldPos.emoji} ${oldPos.name} → ${newPos.emoji} ${newPos.name}`);
        updates.position = newData.normalizedPosition;
    }

    // If no changes, return
    if (changes.length === 0) {
        return message.channel.send('ℹ️ Không có thay đổi nào!');
    }

    // Create confirmation embed
    const confirmEmbed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('⚠️ Xác nhận chỉnh sửa thông tin')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setDescription([
            `Bạn đang chỉnh sửa thông tin của <@${targetUser.id}>`,
            '',
            '**Thay đổi:**',
            ...changes.map(c => `• ${c}`),
            '',
            'Xác nhận thay đổi?'
        ].join('\n'));

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`edit_confirm_${targetUser.id}_${message.author.id}`)
                .setLabel('✅ Xác nhận')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`edit_cancel_${message.author.id}`)
                .setLabel('❌ Hủy')
                .setStyle(ButtonStyle.Danger)
        );

    // Store pending edit in client
    if (!message.client.pendingEdits) {
        message.client.pendingEdits = new Map();
    }

    const key = `${targetUser.id}_${message.author.id}`;
    message.client.pendingEdits.set(key, {
        targetUserId: targetUser.id,
        updates,
        timestamp: Date.now()
    });

    // Auto-cleanup after 5 minutes
    setTimeout(() => {
        message.client.pendingEdits?.delete(key);
    }, 5 * 60 * 1000);

    await message.channel.send({ embeds: [confirmEmbed], components: [row] });
}

/**
 * Execute addmem command
 * @param {Message} message - Discord message
 * @param {Array} args - Command arguments
 */
async function execute(message, args) {
    if (args.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('📋 Hướng dẫn ?addmem')
            .setDescription([
                '**Cú pháp linh hoạt - thứ tự tùy ý:**',
                '```',
                '?addmem <uid> <tên>',
                '?addmem <@user> <uid> <tên> [Xnt]',
                '?addmem <Discord_ID> <tên> <uid> [Xnt]',
                '```',
                '**Ví dụ:**',
                '• `?addmem 329040 Hehehe` - Tự thêm',
                '• `?addmem @rain 23087 Hehe 12nt`',
                '• `?addmem RainĐiTu 012958` - Tên trước',
                '',
                '**💡 Linh hoạt:** UID và tên có thể đổi chỗ!'
            ].join('\n'))
            .setFooter({ text: 'Không cần nhập chức vụ = mặc định mem' });
        return message.channel.send({ embeds: [embed] });
    }

    // ============== SMART ARGUMENT PARSER ==============
    // Parse args to detect: Discord user, UID, name, date, position
    let targetUser = null;
    let gameUid = null;
    let gameName = null;
    let joinDateArg = null;
    let normalizedPosition = 'mem'; // default
    const possiblePositions = ['bc', 'pbc', 'kc', 'mem', ...db.getCustomKcNames()];

    // 1. Check for mention
    const mentionedUser = message.mentions.users.first();
    if (mentionedUser) {
        targetUser = mentionedUser;
    }

    // 2. Parse remaining args
    const remainingArgs = [];
    for (const arg of args) {
        // Skip if it's a mention (already processed)
        if (arg.startsWith('<@') && arg.endsWith('>')) continue;

        // Check if it's a date (Xnt format)
        const dateMatch = arg.toLowerCase().match(/^(\d+)nt$/);
        if (dateMatch) {
            joinDateArg = arg;
            continue;
        }

        // Check if it's a position
        if (possiblePositions.includes(arg.toLowerCase())) {
            normalizedPosition = arg.toLowerCase();
            continue;
        }

        // Check if it's a Discord ID (17-20 digits)
        if (/^\d{17,20}$/.test(arg)) {
            if (!targetUser) {
                try {
                    targetUser = await message.client.users.fetch(arg);
                } catch (e) {
                    // Might not be fetchable, store as ID
                    remainingArgs.push({ type: 'discord_id', value: arg });
                }
            }
            continue;
        }

        // Check if it's a UID (all digits but shorter than Discord ID)
        if (/^\d+$/.test(arg) && arg.length < 17) {
            gameUid = arg;
            continue;
        }

        // Otherwise, it's either a username or game name
        remainingArgs.push({ type: 'text', value: arg });
    }

    // 3. Process remaining text args
    // If no targetUser yet, first text arg might be Discord username
    if (!targetUser && remainingArgs.length > 0) {
        const firstText = remainingArgs[0].value;
        // Try to find Discord user by username
        try {
            let foundMember = message.guild.members.cache.find(m =>
                m.user.username.toLowerCase() === firstText.toLowerCase() ||
                m.displayName?.toLowerCase() === firstText.toLowerCase()
            );
            if (!foundMember) {
                const searchResults = await message.guild.members.search({ query: firstText, limit: 1 });
                foundMember = searchResults.first();
            }
            if (foundMember) {
                targetUser = foundMember.user;
                remainingArgs.shift(); // Remove this arg
            }
        } catch (e) { /* Not a Discord username */ }
    }

    // 4. Assign remaining text args
    // If we have targetUser, remaining texts are game name
    // If we don't, we're self-adding, so remaining text is game name
    if (remainingArgs.length > 0) {
        // Join all remaining text as game name (in case name has spaces or multiple parts)
        gameName = remainingArgs.map(a => a.value).join(' ');
    }

    // 5. Default to self if no target user
    if (!targetUser) {
        targetUser = message.author;
    }

    // 6. AUTO-FILL from pending_ids if data is incomplete
    let pendingData = null;

    // If we have UID but no name, lookup name by UID
    if (gameUid && !gameName) {
        try {
            const pending = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ?').get(gameUid);
            if (pending) {
                gameName = pending.game_username;
                pendingData = pending;
            }
        } catch (e) { /* pending_ids table might not exist yet */ }
    }

    // If we have name but no UID, lookup UID by name
    if (gameName && !gameUid) {
        try {
            const pending = db.db.prepare('SELECT * FROM pending_ids WHERE game_username = ? COLLATE NOCASE').get(gameName);
            if (pending) {
                gameUid = pending.game_uid;
                pendingData = pending;
            }
        } catch (e) { /* pending_ids table might not exist yet */ }
    }

    // If both UID and name exist, still check pending_ids for joined_at
    if (gameUid && gameName && !pendingData) {
        try {
            const pending = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ?').get(gameUid);
            if (pending) {
                pendingData = pending;
            }
        } catch (e) { /* ignore */ }
    }

    // 7. CHECK IF USER EXISTS FIRST (for edit detection)
    const existingUser = db.getUserByDiscordId(targetUser.id);

    // EDIT MODE: If user exists and hasn't left, this is an edit
    if (existingUser && !existingUser.left_at) {
        return handleEditMode(message, targetUser, existingUser, {
            gameUid,
            gameName,
            joinDate: joinDateArg ? parseJoinDate(joinDateArg) : null,
            normalizedPosition
        });
    }

    // 8. Validate we have minimum required info (ONLY for new adds/rejoins)
    if (!gameUid || !gameName) {
        return message.channel.send('❌ Thiếu thông tin! Cần ít nhất: **UID** và **Tên game**\n💡 Ví dụ: `?addmem 123456 TenGame`');
    }

    // ============== PERMISSION CHECK ==============
    const isAddingSelf = targetUser.id === message.author.id;

    // Check position-specific permissions
    if (normalizedPosition === 'bc' || normalizedPosition === 'pbc') {
        if (!hasRole(message.member, 'Quản Lý')) {
            return message.channel.send('❌ Bạn không có quyền thêm BC/PBC! Yêu cầu role: **Quản Lý**');
        }
    } else if (normalizedPosition === 'kc' || possiblePositions.includes(normalizedPosition) && normalizedPosition !== 'mem') {
        if (!hasHighLevelRole(message.member)) {
            return message.channel.send('❌ Bạn không có quyền thêm KC! Yêu cầu role: **Quản Lý** hoặc **Kỳ Cựu**');
        }
    } else if (!isAddingSelf && !hasHighLevelRole(message.member)) {
        return message.channel.send('❌ Bạn chỉ có thể tự thêm thông tin của mình!');
    }

    // Check unique positions
    if (['bc', 'pbc'].includes(normalizedPosition)) {
        const existingHolder = db.getUniquePositionHolder(normalizedPosition);
        if (existingHolder && existingHolder.discord_id !== targetUser.id) {
            return message.channel.send(`❌ ${normalizedPosition.toUpperCase()} đã tồn tại: <@${existingHolder.discord_id}>`);
        }
    }

    // ============== PARSE DATE ==============
    let joinDate = new Date();
    if (joinDateArg) {
        const parsedDate = parseJoinDate(joinDateArg);
        if (parsedDate) joinDate = parsedDate;
    } else if (pendingData && pendingData.joined_at) {
        // Use joined_at from pending_ids if no date argument provided
        joinDate = new Date(pendingData.joined_at);
    }

    // ============== ADD TO DATABASE ==============
    const userData = {
        discordId: targetUser.id,
        discordName: targetUser.username,
        gameUsername: gameName,
        gameUid: gameUid,
        position: normalizedPosition,
        joinedAt: joinDate.toISOString()
    };

    try {
        // Check if this is a rejoin (user left before)
        let isRejoin = existingUser && existingUser.left_at;
        let rejoinCount = isRejoin ? (existingUser.rejoin_count || 0) + 1 : 0;

        if (isRejoin) {
            db.rejoinUser(targetUser.id, userData);
        } else {
            db.upsertUser(userData);
        }

        // Remove from pending_ids if it exists there (by UID or name)
        try {
            db.db.prepare('DELETE FROM pending_ids WHERE game_uid = ? OR game_username = ? COLLATE NOCASE').run(gameUid, gameName);
        } catch (e) { /* Table might not exist */ }

        // Add custom kc name if needed
        const posValidation = validatePosition(normalizedPosition);
        if (posValidation.isKcVariant) {
            db.addCustomKcName(normalizedPosition);
        }

        const posDisplay = getPositionDisplay(normalizedPosition);
        const embed = new EmbedBuilder()
            .setColor(posDisplay.color)
            .setTitle(`${posDisplay.emoji} ${isRejoin ? 'Thành viên quay lại!' : 'Đã thêm thành viên!'}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 Discord', value: `<@${targetUser.id}>`, inline: true },
                { name: `${posDisplay.emoji} Chức vụ`, value: posDisplay.name, inline: true },
                { name: '🎮 Tên Game', value: gameName, inline: true },
                { name: '🆔 UID', value: gameUid, inline: true },
                { name: '📅 Ngày tham gia', value: `<t:${Math.floor(joinDate.getTime() / 1000)}:D>`, inline: true }
            )
            .setFooter({ text: `Thêm bởi ${message.author.username}` })
            .setTimestamp();

        if (isRejoin) embed.addFields({ name: '🔄 Rejoin', value: `${rejoinCount}`, inline: true });

        // Role handling
        try {
            const member = await message.guild.members.fetch(targetUser.id);
            const choDuyetRole = message.guild.roles.cache.find(r => r.name === 'Chờ Duyệt');
            if (choDuyetRole && member.roles.cache.has(choDuyetRole.id)) await member.roles.remove(choDuyetRole);
            let langGiaRole = message.guild.roles.cache.find(r => r.name === 'LangGia');
            if (!langGiaRole) langGiaRole = await message.guild.roles.create({ name: 'LangGia', color: 0x3498DB });
            if (!member.roles.cache.has(langGiaRole.id)) await member.roles.add(langGiaRole);
        } catch (e) { /* ignore */ }

        return message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error adding member:', error);
        return message.channel.send('❌ Có lỗi xảy ra khi thêm thành viên!');
    }

}

module.exports = { execute };


