/**
 * ?addid command - Pre-add game UID and name to database
 * Usage: ?addid <uid> <game_name>
 * 
 * Stores UID and game name for later association with Discord user
 * Useful for bulk importing game data before linking to Discord accounts
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const memberRosterSync = require('../../utils/memberRosterSync');
const { buildChange, logMemberRosterAction } = require('../../utils/memberRosterLog');

/**
 * Check if user has high-level role (BC, PBC, KC)
 */
function hasHighLevelRole(member) {
    return member.roles.cache.some(role =>
        role.name === 'Quản Lý' || role.name === 'Kỳ Cựu'
    );
}

/**
 * Parse join date from "Xnt" format
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

function ensurePendingIdsTable() {
    try {
        db.db.prepare(`
            CREATE TABLE IF NOT EXISTS pending_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_uid TEXT NOT NULL,
                game_username TEXT NOT NULL,
                added_by TEXT NOT NULL,
                added_by_name TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                joined_at DATETIME,
                guild_id TEXT,
                source TEXT DEFAULT 'bot',
                supabase_id TEXT
            )
        `).run();

        try {
            db.db.prepare(`ALTER TABLE pending_ids ADD COLUMN joined_at DATETIME`).run();
        } catch (e) {
            if (!e.message.includes('duplicate column')) {
                console.error('Error adding joined_at column:', e);
            }
        }

        try {
            db.db.prepare(`ALTER TABLE pending_ids ADD COLUMN guild_id TEXT`).run();
        } catch (e) {
            if (!e.message.includes('duplicate column')) {
                console.error('Error adding guild_id column:', e);
            }
        }
        try {
            db.db.prepare(`ALTER TABLE pending_ids ADD COLUMN added_by_name TEXT`).run();
        } catch (e) { }
        try {
            db.db.prepare(`ALTER TABLE pending_ids ADD COLUMN source TEXT DEFAULT 'bot'`).run();
        } catch (e) { }
        try {
            db.db.prepare(`ALTER TABLE pending_ids ADD COLUMN supabase_id TEXT`).run();
        } catch (e) { }
    } catch (e) {
        console.error('Error creating pending_ids table:', e);
    }
}

function getUserByUidState(gameUid, guildId, isLeft) {
    const leftClause = isLeft ? 'left_at IS NOT NULL' : 'left_at IS NULL';
    try {
        if (guildId) {
            return db.db.prepare(`
                SELECT * FROM users
                WHERE game_uid = ? AND ${leftClause} AND (guild_id = ? OR guild_id IS NULL)
                ORDER BY CASE WHEN guild_id = ? THEN 0 ELSE 1 END
                LIMIT 1
            `).get(gameUid, guildId, guildId);
        }
        return db.db.prepare(`SELECT * FROM users WHERE game_uid = ? AND ${leftClause}`).get(gameUid);
    } catch (e) {
        return db.db.prepare(`SELECT * FROM users WHERE game_uid = ? AND ${leftClause}`).get(gameUid);
    }
}

function getPendingByUid(gameUid, guildId) {
    try {
        if (guildId) {
            const scoped = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? AND guild_id = ?').get(gameUid, guildId);
            if (scoped) return scoped;
            return db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ? AND guild_id IS NULL').get(gameUid);
        }
        return db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ?').get(gameUid);
    } catch (e) {
        return null;
    }
}

function insertPendingId(gameUid, gameName, authorId, authorName, joinedAt, guildId) {
    try {
        return db.db.prepare(`
            INSERT INTO pending_ids (game_uid, game_username, added_by, added_by_name, joined_at, guild_id, source)
            VALUES (?, ?, ?, ?, ?, ?, 'bot')
        `).run(gameUid, gameName, authorId, authorName || authorId, joinedAt, guildId || null);
    } catch (e) {
        return db.db.prepare(`
            INSERT INTO pending_ids (game_uid, game_username, added_by, joined_at)
            VALUES (?, ?, ?, ?)
        `).run(gameUid, gameName, authorId, joinedAt);
    }
}

function updatePendingId(gameUid, gameName, authorId, authorName, joinedAt, guildId) {
    try {
        if (guildId) {
            const result = db.db.prepare(`
                UPDATE pending_ids
                SET game_username = ?, added_by = ?, added_by_name = ?, added_at = CURRENT_TIMESTAMP, joined_at = ?, guild_id = ?, source = 'bot'
                WHERE game_uid = ? AND (guild_id = ? OR guild_id IS NULL)
            `).run(gameName, authorId, authorName || authorId, joinedAt, guildId, gameUid, guildId);
            return result;
        }
        return db.db.prepare(`
            UPDATE pending_ids
            SET game_username = ?, added_by = ?, added_at = CURRENT_TIMESTAMP, joined_at = ?, source = 'bot'
            WHERE game_uid = ?
        `).run(gameName, authorId, joinedAt, gameUid);
    } catch (e) {
        return db.db.prepare(`
            UPDATE pending_ids
            SET game_username = ?, added_by = ?, added_at = CURRENT_TIMESTAMP, joined_at = ?
            WHERE game_uid = ?
        `).run(gameName, authorId, joinedAt, gameUid);
    }
}

function deletePendingByUid(gameUid, guildId) {
    try {
        if (guildId) {
            return db.db.prepare('DELETE FROM pending_ids WHERE game_uid = ? AND (guild_id = ? OR guild_id IS NULL)').run(gameUid, guildId);
        }
        return db.db.prepare('DELETE FROM pending_ids WHERE game_uid = ?').run(gameUid);
    } catch (e) {
        return null;
    }
}

function deleteLeftUserByUid(gameUid, guildId) {
    try {
        if (guildId) {
            return db.db.prepare('DELETE FROM users WHERE game_uid = ? AND left_at IS NOT NULL AND (guild_id = ? OR guild_id IS NULL)').run(gameUid, guildId);
        }
        return db.db.prepare('DELETE FROM users WHERE game_uid = ? AND left_at IS NOT NULL').run(gameUid);
    } catch (e) {
        return null;
    }
}

async function execute(message, args) {
    // Permission check - only BC, PBC, KC
    if (!hasHighLevelRole(message.member)) {
        return message.channel.send('❌ Bạn không có quyền thực hiện lệnh này! Yêu cầu role: **Quản Lý** hoặc **Kỳ Cựu**');
    }

    if (args.length < 2) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('📋 Hướng dẫn ?addid')
            .setDescription([
                '**🔐 Quyền:** Chỉ BC, PBC, KC (role Quản Lý hoặc Kỳ Cựu)',
                '',
                '**Cú pháp:**',
                '```',
                '?addid <uid> <tên_game> [Xnt]',
                '```',
                '',
                '**Ví dụ:**',
                '• `?addid 8919579 RainDiTu`',
                '• `?addid 4026807103 Arisusagi 33nt` - Vào 33 ngày trước',
                '',
                '**💡 Lưu ý:**',
                '• Lưu UID + tên game vào danh sách chờ',
                '• **Nhập lại = cập nhật đè** (có xác nhận)',
                '• **UID đã rời guild?** → Hiện bảng xác nhận để reset trạng thái',
                '• Dùng `?addmem` để link với Discord user sau'
            ].join('\n'))
            .setFooter({ text: 'Bulk add game data trước, link Discord sau' });

        return message.channel.send({ embeds: [embed] });
    }

    const guildId = message.guild?.id || null;

    // Parse arguments - support flexible order with date
    let gameUid = null;
    let gameName = null;
    let joinDateArg = null;
    let joinDate = new Date();

    // Collect non-date args
    const nonDateArgs = [];
    for (const arg of args) {
        const dateMatch = arg.toLowerCase().match(/^(\d+)nt$/);
        if (dateMatch) {
            joinDateArg = arg;
            const parsed = parseJoinDate(arg);
            if (parsed) joinDate = parsed;
        } else {
            nonDateArgs.push(arg);
        }
    }

    // Parse UID and name from non-date args
    if (/^\d+$/.test(nonDateArgs[0])) {
        gameUid = nonDateArgs[0];
        gameName = nonDateArgs.slice(1).join(' ');
    } else {
        const lastArg = nonDateArgs[nonDateArgs.length - 1];
        if (/^\d+$/.test(lastArg)) {
            gameUid = lastArg;
            gameName = nonDateArgs.slice(0, -1).join(' ');
        } else {
            return message.channel.send('❌ Thiếu UID! Cần một chuỗi số.\n💡 VD: `?addid 123456 TenGame`');
        }
    }

    if (!gameUid || !gameName) {
        return message.channel.send('❌ Thiếu thông tin! Cần cả **UID** và **Tên game**');
    }

    ensurePendingIdsTable();

    // Check if UID already exists in users table and hasn't left
    const activeUser = getUserByUidState(gameUid, guildId, false);
    if (activeUser) {
        return message.channel.send(`❌ UID \`${gameUid}\` đã tồn tại trong database và đang hoạt động!\nUser: <@${activeUser.discord_id}> - ${activeUser.game_username}`);
    }

    // Check if UID belongs to a user who was marked as LEFT guild
    const leftUser = getUserByUidState(gameUid, guildId, true);
    if (leftUser) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const leftDate = new Date(leftUser.left_at);
        const joinedDate = leftUser.joined_at ? new Date(leftUser.joined_at) : null;

        const confirmEmbed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('⚠️ Thành viên đã bị đánh dấu rời guild!')
            .setDescription([
                `UID \`${gameUid}\` thuộc về thành viên đã bị đánh dấu **rời guild**.`,
                '',
                `👤 **Tên game:** ${leftUser.game_username}`,
                `🆔 **UID:** ${gameUid}`,
                `📅 **Ngày vào cũ:** ${joinedDate ? `<t:${Math.floor(joinedDate.getTime() / 1000)}:D>` : 'N/A'}`,
                `📤 **Ngày rời:** <t:${Math.floor(leftDate.getTime() / 1000)}:D>`,
                leftUser.discord_id && !leftUser.discord_id.startsWith('pending_')
                    ? `💬 **Discord cũ:** <@${leftUser.discord_id}>`
                    : '',
                '',
                '**Chọn hành động:**',
                '✅ **Chưa rời** — Họ chưa rời in-game, giữ ngày vào cũ',
                `🔄 **Vào lại** — Họ đã rời thật, nay quay lại (reset ngày vào)`,
            ].filter(Boolean).join('\n'));

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`addid_reset_${gameUid}_${message.author.id}`)
                    .setLabel('✅ Chưa rời')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`addid_rejoin_${gameUid}_${message.author.id}`)
                    .setLabel('🔄 Vào lại guild')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`addid_resetcancel_${gameUid}_${message.author.id}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Danger)
            );

        const confirmMsg = await message.channel.send({ embeds: [confirmEmbed], components: [row] });

        // Lưu data tạm cho confirmation handler
        global.pendingAddidConfirmations = global.pendingAddidConfirmations || new Map();
        global.pendingAddidConfirmations.set(`reset_${gameUid}_${message.author.id}`, {
            gameUid,
            gameName,
            joinDate,
            leftUser,
            confirmMsg,
            type: 'reset',
            guildId
        });

        // Auto-cancel sau 30 giây
        setTimeout(() => {
            global.pendingAddidConfirmations?.delete(`reset_${gameUid}_${message.author.id}`);
        }, 30000);

        return;
    }

    // Check if UID already in pending - need confirmation to overwrite
    const existingPending = getPendingByUid(gameUid, guildId);

    if (existingPending) {
        // Request confirmation
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const confirmEmbed = new EmbedBuilder()
            .setColor(0xF59E0B)
            .setTitle('⚠️ Xác nhận cập nhật')
            .setDescription([
                `UID \`${gameUid}\` đã tồn tại trong danh sách chờ!`,
                '',
                `**Hiện tại:** ${existingPending.game_username}`,
                `**Cập nhật thành:** ${gameName}`,
                '',
                'Bạn có chắc muốn đè thông tin này?'
            ].join('\n'));

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`addid_confirm_${gameUid}_${message.author.id}`)
                    .setLabel('✅ Xác nhận')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`addid_cancel_${gameUid}_${message.author.id}`)
                    .setLabel('❌ Hủy')
                    .setStyle(ButtonStyle.Danger)
            );

        const confirmMsg = await message.channel.send({ embeds: [confirmEmbed], components: [row] });

        // Store data temporarily for confirmation handler
        global.pendingAddidConfirmations = global.pendingAddidConfirmations || new Map();
        global.pendingAddidConfirmations.set(`${gameUid}_${message.author.id}`, {
            gameUid,
            gameName,
            joinDate,
            existingPending,
            confirmMsg,
            guildId
        });

        // Auto-cancel after 30 seconds
        setTimeout(() => {
            global.pendingAddidConfirmations?.delete(`${gameUid}_${message.author.id}`);
        }, 30000);

        return;
    }

    // Insert new entry
    try {
        insertPendingId(gameUid, gameName, message.author.id, message.author.username, joinDate.toISOString(), guildId);
        await memberRosterSync.syncPendingByUid(gameUid, guildId);
        void logMemberRosterAction(guildId, 'pending_add', {
            summary: `Them pending ${gameName}`,
            actor_id: message.author.id,
            actor_name: message.author.username,
            target_type: 'pending',
            target_id: gameUid,
            target_name: gameName,
            target_uid: gameUid,
            changes: [
                { field: 'status', label: 'Trang thai', before: null, after: 'pending' },
                { field: 'joined_at', label: 'Ngay vao', before: null, after: joinDate.toISOString() }
            ]
        }, message.author.id);

        const embed = new EmbedBuilder()
            .setColor(0x00D166)
            .setTitle('✅ Đã thêm vào danh sách chờ!')
            .addFields(
                { name: '🆔 UID', value: gameUid, inline: true },
                { name: '🎮 Tên Game', value: gameName, inline: true },
                { name: '📅 Ngày vào', value: `<t:${Math.floor(joinDate.getTime() / 1000)}:D>`, inline: true },
                { name: '📝 Người thêm', value: `<@${message.author.id}>`, inline: true }
            )
            .setFooter({ text: '💡 Dùng ?addmem để link với Discord user' })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error adding pending ID:', error);
        await message.channel.send('❌ Có lỗi xảy ra khi thêm vào danh sách chờ!');
    }
}

/**
 * Handle confirmation button for overwrite and reset
 */
async function handleConfirmation(interaction) {
    const customId = interaction.customId;

    // Parse customId - có 2 dạng:
    // addid_confirm_<uid>_<authorId> / addid_cancel_<uid>_<authorId>
    // addid_reset_<uid>_<authorId> / addid_resetcancel_<uid>_<authorId>
    const parts = customId.split('_');
    // parts[0] = "addid", parts[1] = action, ...

    const action = parts[1]; // "confirm", "cancel", "reset", "resetcancel"

    // Xác định authorId và gameUid dựa trên action
    let gameUid, authorId;
    if (action === 'resetcancel') {
        // addid_resetcancel_<uid>_<authorId>
        gameUid = parts[2];
        authorId = parts[3];
    } else {
        // addid_confirm/cancel/reset_<uid>_<authorId>
        gameUid = parts[2];
        authorId = parts[3];
    }

    if (interaction.user.id !== authorId) {
        return interaction.reply({ content: '❌ Chỉ người sử dụng lệnh mới được xác nhận!', ephemeral: true });
    }

    // ============== RESET: Chưa rời guild (giữ ngày vào cũ) ==============
    if (action === 'reset') {
        const key = `reset_${gameUid}_${authorId}`;
        const data = global.pendingAddidConfirmations?.get(key);

        if (!data) {
            return interaction.update({ content: '❌ Phiên xác nhận đã hết hạn!', embeds: [], components: [] });
        }

        try {
            const guildId = data.guildId || interaction.guild?.id || null;
            // Giữ ngày vào cũ từ record gốc
            const keepJoinDate = data.leftUser.joined_at || new Date().toISOString();

            // 1. Xóa khỏi bảng users
            deleteLeftUserByUid(gameUid, guildId);

            // 2. Xóa pending cũ nếu có
            deletePendingByUid(gameUid, guildId);

            // 3. Thêm vào pending_ids với ngày vào CŨ (giữ nguyên)
            if (data.leftUser?.discord_id && !String(data.leftUser.discord_id).startsWith('pending_')) {
                await memberRosterSync.deleteUserFromSupabase(data.leftUser.discord_id);
            }

            insertPendingId(gameUid, data.gameName, authorId, interaction.user.username, keepJoinDate, guildId);
            await memberRosterSync.syncPendingByUid(gameUid, guildId);
            void logMemberRosterAction(guildId, 'pending_add', {
                summary: `Dua ${data.gameName} ve pending`,
                actor_id: authorId,
                actor_name: interaction.user.username,
                target_type: 'pending',
                target_id: gameUid,
                target_name: data.gameName,
                target_uid: gameUid,
                changes: [
                    { field: 'status', label: 'Trang thai', before: 'left', after: 'pending' },
                    { field: 'joined_at', label: 'Ngay vao', before: data.leftUser?.joined_at || null, after: keepJoinDate }
                ]
            }, authorId);

            const joinDateObj = new Date(keepJoinDate);
            const embed = new EmbedBuilder()
                .setColor(0x00D166)
                .setTitle('✅ Đánh dấu chưa rời guild!')
                .setDescription([
                    `Thành viên **${data.gameName}** được xác nhận **chưa rời guild**.`,
                    '',
                    '**Đã thực hiện:**',
                    '• Xóa đánh dấu rời guild',
                    '• Giữ nguyên ngày vào cũ',
                    '• Đưa về danh sách chờ link Discord',
                ].join('\n'))
                .addFields(
                    { name: '🆔 UID', value: gameUid, inline: true },
                    { name: '🎮 Tên Game', value: data.gameName, inline: true },
                    { name: '📅 Ngày vào (giữ cũ)', value: `<t:${Math.floor(joinDateObj.getTime() / 1000)}:D>`, inline: true },
                    { name: '📝 Người thực hiện', value: `<@${authorId}>`, inline: true }
                )
                .setFooter({ text: '💡 Dùng ?addmem để link với Discord user mới' })
                .setTimestamp();

            await interaction.update({ embeds: [embed], components: [] });
            global.pendingAddidConfirmations.delete(key);
        } catch (error) {
            console.error('Error resetting user status:', error);
            await interaction.update({ content: '❌ Có lỗi xảy ra khi reset trạng thái!', embeds: [], components: [] });
        }
        return;
    }

    // ============== REJOIN: Vào lại guild (reset ngày vào mới) ==============
    if (action === 'rejoin') {
        const key = `reset_${gameUid}_${authorId}`;
        const data = global.pendingAddidConfirmations?.get(key);

        if (!data) {
            return interaction.update({ content: '❌ Phiên xác nhận đã hết hạn!', embeds: [], components: [] });
        }

        try {
            const guildId = data.guildId || interaction.guild?.id || null;
            // 1. Xóa khỏi bảng users
            deleteLeftUserByUid(gameUid, guildId);

            // 2. Xóa pending cũ nếu có
            deletePendingByUid(gameUid, guildId);

            // 3. Thêm vào pending_ids với ngày vào MỚI (hôm nay hoặc Xnt)
            if (data.leftUser?.discord_id && !String(data.leftUser.discord_id).startsWith('pending_')) {
                await memberRosterSync.deleteUserFromSupabase(data.leftUser.discord_id);
            }

            insertPendingId(gameUid, data.gameName, authorId, interaction.user.username, data.joinDate.toISOString(), guildId);
            await memberRosterSync.syncPendingByUid(gameUid, guildId);
            void logMemberRosterAction(guildId, 'pending_add', {
                summary: `Rejoin pending ${data.gameName}`,
                actor_id: authorId,
                actor_name: interaction.user.username,
                target_type: 'pending',
                target_id: gameUid,
                target_name: data.gameName,
                target_uid: gameUid,
                changes: [
                    { field: 'status', label: 'Trang thai', before: 'left', after: 'pending' },
                    { field: 'joined_at', label: 'Ngay vao', before: data.leftUser?.joined_at || null, after: data.joinDate.toISOString() }
                ]
            }, authorId);

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('🔄 Thành viên vào lại guild!')
                .setDescription([
                    `Thành viên **${data.gameName}** đã vào lại guild.`,
                    '',
                    '**Đã thực hiện:**',
                    '• Xóa record cũ (đã rời)',
                    '• Reset ngày vào = hôm nay',
                    '• Đưa về danh sách chờ link Discord',
                ].join('\n'))
                .addFields(
                    { name: '🆔 UID', value: gameUid, inline: true },
                    { name: '🎮 Tên Game', value: data.gameName, inline: true },
                    { name: '📅 Ngày vào (mới)', value: `<t:${Math.floor(data.joinDate.getTime() / 1000)}:D>`, inline: true },
                    { name: '📝 Người thực hiện', value: `<@${authorId}>`, inline: true }
                )
                .setFooter({ text: '💡 Dùng ?addmem để link với Discord user mới' })
                .setTimestamp();

            await interaction.update({ embeds: [embed], components: [] });
            global.pendingAddidConfirmations.delete(key);
        } catch (error) {
            console.error('Error rejoin user:', error);
            await interaction.update({ content: '❌ Có lỗi xảy ra khi xử lý vào lại guild!', embeds: [], components: [] });
        }
        return;
    }

    // ============== RESET CANCEL ==============
    if (action === 'resetcancel') {
        const key = `reset_${gameUid}_${authorId}`;
        global.pendingAddidConfirmations?.delete(key);
        return interaction.update({ content: '❌ Đã hủy reset trạng thái.', embeds: [], components: [] });
    }

    // ============== OVERWRITE PENDING (logic cũ) ==============
    const key = `${gameUid}_${authorId}`;
    const data = global.pendingAddidConfirmations?.get(key);

    if (!data) {
        return interaction.update({ content: '❌ Phiên xác nhận đã hết hạn!', embeds: [], components: [] });
    }

    if (action === 'cancel') {
        global.pendingAddidConfirmations.delete(key);
        return interaction.update({ content: '❌ Đã hủy cập nhật.', embeds: [], components: [] });
    }

    // Confirm - update the entry
    try {
        const guildId = data.guildId || interaction.guild?.id || null;
        updatePendingId(gameUid, data.gameName, authorId, interaction.user.username, data.joinDate.toISOString(), guildId);
        await memberRosterSync.syncPendingByUid(gameUid, guildId);
        void logMemberRosterAction(guildId, 'pending_update', {
            summary: `Cap nhat pending ${data.gameName}`,
            actor_id: authorId,
            actor_name: interaction.user.username,
            target_type: 'pending',
            target_id: gameUid,
            target_name: data.gameName,
            target_uid: gameUid,
            changes: [
                buildChange('game_username', 'Ten game', data.existingPending?.game_username || '', data.gameName || ''),
                buildChange('game_uid', 'UID', data.existingPending?.game_uid || gameUid, gameUid),
                buildChange('joined_at', 'Ngay vao', data.existingPending?.joined_at || '', data.joinDate.toISOString())
            ]
        }, authorId);

        const embed = new EmbedBuilder()
            .setColor(0xF59E0B)
            .setTitle('✏️ Đã cập nhật danh sách chờ!')
            .setDescription(`Cập nhật từ: **${data.existingPending.game_username}** → **${data.gameName}**`)
            .addFields(
                { name: '🆔 UID', value: gameUid, inline: true },
                { name: '🎮 Tên Game', value: data.gameName, inline: true },
                { name: '📅 Ngày vào', value: `<t:${Math.floor(data.joinDate.getTime() / 1000)}:D>`, inline: true },
                { name: '📝 Người cập nhật', value: `<@${authorId}>`, inline: true }
            )
            .setFooter({ text: '💡 Dùng ?addmem để link với Discord user' })
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
        global.pendingAddidConfirmations.delete(key);
    } catch (error) {
        console.error('Error updating pending ID:', error);
        await interaction.update({ content: '❌ Có lỗi xảy ra khi cập nhật!', embeds: [], components: [] });
    }
}

module.exports = { execute, handleConfirmation };
