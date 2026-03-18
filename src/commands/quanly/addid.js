/**
 * ?addid command - Pre-add game UID and name to database
 * Usage: ?addid <uid> <game_name>
 * 
 * Stores UID and game name for later association with Discord user
 * Useful for bulk importing game data before linking to Discord accounts
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

    // Ensure pending_ids table exists with joined_at column
    try {
        db.db.prepare(`
            CREATE TABLE IF NOT EXISTS pending_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_uid TEXT NOT NULL,
                game_username TEXT NOT NULL,
                added_by TEXT NOT NULL,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                joined_at DATETIME
            )
        `).run();

        // Migrate: Add joined_at column if it doesn't exist
        try {
            db.db.prepare(`ALTER TABLE pending_ids ADD COLUMN joined_at DATETIME`).run();
        } catch (e) {
            // Column already exists, ignore
            if (!e.message.includes('duplicate column')) {
                console.error('Error adding joined_at column:', e);
            }
        }
    } catch (e) {
        console.error('Error creating pending_ids table:', e);
    }

    // Check if UID already exists in users table and hasn't left
    const activeUser = db.db.prepare('SELECT * FROM users WHERE game_uid = ? AND left_at IS NULL').get(gameUid);
    if (activeUser) {
        return message.channel.send(`❌ UID \`${gameUid}\` đã tồn tại trong database và đang hoạt động!\nUser: <@${activeUser.discord_id}> - ${activeUser.game_username}`);
    }

    // Check if UID belongs to a user who was marked as LEFT guild
    const leftUser = db.db.prepare('SELECT * FROM users WHERE game_uid = ? AND left_at IS NOT NULL').get(gameUid);
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
            type: 'reset'
        });

        // Auto-cancel sau 30 giây
        setTimeout(() => {
            global.pendingAddidConfirmations?.delete(`reset_${gameUid}_${message.author.id}`);
        }, 30000);

        return;
    }

    // Check if UID already in pending - need confirmation to overwrite
    const existingPending = db.db.prepare('SELECT * FROM pending_ids WHERE game_uid = ?').get(gameUid);

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
            confirmMsg
        });

        // Auto-cancel after 30 seconds
        setTimeout(() => {
            global.pendingAddidConfirmations?.delete(`${gameUid}_${message.author.id}`);
        }, 30000);

        return;
    }

    // Insert new entry
    try {
        db.db.prepare(`
            INSERT INTO pending_ids (game_uid, game_username, added_by, joined_at)
            VALUES (?, ?, ?, ?)
        `).run(gameUid, gameName, message.author.id, joinDate.toISOString());

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
            // Giữ ngày vào cũ từ record gốc
            const keepJoinDate = data.leftUser.joined_at || new Date().toISOString();

            // 1. Xóa khỏi bảng users
            db.db.prepare('DELETE FROM users WHERE game_uid = ? AND left_at IS NOT NULL').run(gameUid);

            // 2. Xóa pending cũ nếu có
            try {
                db.db.prepare('DELETE FROM pending_ids WHERE game_uid = ?').run(gameUid);
            } catch (e) { /* ignore */ }

            // 3. Thêm vào pending_ids với ngày vào CŨ (giữ nguyên)
            db.db.prepare(`
                INSERT INTO pending_ids (game_uid, game_username, added_by, joined_at)
                VALUES (?, ?, ?, ?)
            `).run(gameUid, data.gameName, authorId, keepJoinDate);

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
            // 1. Xóa khỏi bảng users
            db.db.prepare('DELETE FROM users WHERE game_uid = ? AND left_at IS NOT NULL').run(gameUid);

            // 2. Xóa pending cũ nếu có
            try {
                db.db.prepare('DELETE FROM pending_ids WHERE game_uid = ?').run(gameUid);
            } catch (e) { /* ignore */ }

            // 3. Thêm vào pending_ids với ngày vào MỚI (hôm nay hoặc Xnt)
            db.db.prepare(`
                INSERT INTO pending_ids (game_uid, game_username, added_by, joined_at)
                VALUES (?, ?, ?, ?)
            `).run(gameUid, data.gameName, authorId, data.joinDate.toISOString());

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
        db.db.prepare(`
            UPDATE pending_ids 
            SET game_username = ?, added_by = ?, added_at = CURRENT_TIMESTAMP, joined_at = ?
            WHERE game_uid = ?
        `).run(data.gameName, authorId, data.joinDate.toISOString(), gameUid);

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
