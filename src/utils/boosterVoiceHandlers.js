/**
 * Booster Voice Room Handlers
 * Xử lý tất cả button/select/modal có prefix "boostvc_"
 * 
 * --- BLACKLIST MODE ---
 * Danh sách người trong room hoạt động theo 2 chế độ:
 *   - whitelist: Người trong DS được ưu tiên vào khi phòng Khoá / thấy khi Ẩn
 *   - blacklist: Người trong DS bị chặn xem kênh (Public) hoặc chặn connect (Locked/Hidden)
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database/db');

// ── Custom Emoji IDs cho decor VIP (animated) ──
const EMOJI = {
    tenlua: '<a:oz_rocket:1251414424422580314>',
    booster: '<a:oz_boost:1251399419467792495>',
    kimcuong: '<a:oz_diamond:1251414256990031965>',
    tiendo: '<a:oz_money:1251399400803008542>'
};

// ═══════════════════════════════════════════════════════════════════════════
// HÀM TỔNG HỢP — Cập nhật toàn bộ permission dựa trên mode + list_mode
// Đây là nguồn chân lý duy nhất cho việc cấp quyền kênh VIP Room
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cập nhật permission cho voice channel theo mode + list_mode hiện tại.
 * @param {VoiceChannel} channel - Discord voice channel
 * @param {Object} room - Dữ liệu phòng từ DB (mode, list_mode, user_id)
 * @param {{ whitelist: string[], blacklist: string[] }} allMembers - Cả 2 danh sách
 */
async function updateRoomPermissions(channel, room, allMembers) {
    const mode = room.mode || 'hidden';
    const listMode = room.list_mode || 'whitelist';
    const guildId = channel.guild.id;
    const ownerId = room.user_id;

    const whitelist = allMembers.whitelist || [];
    const blacklist = allMembers.blacklist || [];

    // Danh sách active (list đang áp dụng)
    const activeList = listMode === 'blacklist' ? blacklist : whitelist;
    // Tất cả member cần reset overwrite trước
    const allIds = [...new Set([...whitelist, ...blacklist])];

    try {
        // Bước 1: Đặt quyền @everyone theo mode
        if (mode === 'hidden') {
            await channel.permissionOverwrites.edit(guildId, { ViewChannel: false, Connect: false });
        } else if (mode === 'public') {
            await channel.permissionOverwrites.edit(guildId, { ViewChannel: true, Connect: true });
        } else if (mode === 'locked') {
            await channel.permissionOverwrites.edit(guildId, { ViewChannel: true, Connect: false });
        }

        // Bước 2: Xóa sạch overwrite của tất cả member trong cả 2 list
        // (tránh chồng đè giữa 2 list khi toggle)
        for (const id of allIds) {
            await channel.permissionOverwrites.delete(id).catch(() => {});
        }

        // Bước 3: Áp dụng list active
        if (listMode === 'whitelist') {
            // Whitelist: người trong DS được uu tiên
            for (const id of activeList) {
                if (mode === 'hidden') {
                    // Whitelist + Ẩn: thấy và vào được
                    await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true }).catch(() => {});
                } else if (mode === 'locked') {
                    // Whitelist + Khoá: vào được trong khi người ngoài không thể
                    await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true }).catch(() => {});
                }
                // Whitelist + Công khai: không cần overwrite (mọi người đều vào được rồi)
            }
        } else {
            // Blacklist: người trong DS bị chặn hoàn toàn (mọi chế độ)
            for (const id of activeList) {
                await channel.permissionOverwrites.edit(id, { ViewChannel: false, Connect: false }).catch(() => {});
            }
        }

        // Bước 4: Đảm bảo owner luôn có full quyền
        await channel.permissionOverwrites.edit(ownerId, {
            ViewChannel: true,
            Connect: true,
            MuteMembers: true,
            MoveMembers: true
        }).catch(() => {});

    } catch (e) {
        console.error('[BoostVC] updateRoomPermissions error:', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL PANEL — Gửi khi booster vào room
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tạo embed + buttons cho bảng điều khiển VIP Room (4 hàng gọn gàng)
 */
function createControlPanel(userId, room, member = null) {
    const modeLabel = { hidden: '👻 Ẩn', public: '🌐 Công khai', locked: '🔒 Khoá' };
    const listMode = room.list_mode || 'whitelist';
    const isBlacklist = listMode === 'blacklist';
    const displayName = member ? member.displayName : (room.room_name || 'Booster');
    const avatarURL = member ? member.user.displayAvatarURL({ size: 128 }) : null;

    const embed = new EmbedBuilder()
        .setColor('#FF73FA')
        .setTitle(`${EMOJI.booster} Bảng Điều Khiển VIP Room`)
        .setDescription(
            `${EMOJI.tenlua} **Chào mừng, ${displayName}!**\n\n` +
            `${EMOJI.kimcuong} **Chế độ:** ${modeLabel[room.mode] || '👻 Ẩn'} ` +
            `| **Danh sách:** ${isBlacklist ? '⛔ Blacklist' : '✅ Whitelist'}\n\n` +
            `Dùng các nút bên dưới để quản lý room.\n\n` +
            `💡 *Cần mở lại bảng? Tag bot hoặc gọi tên: đại ngỗng, ngỗng,...*`
        )
        .setFooter({ text: `${displayName} • VIP Room • Chỉ owner nhìn thấy` });

    if (avatarURL) embed.setThumbnail(avatarURL);

    // ── Hàng 1: Chế độ kênh ──
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`boostvc_hidden_${userId}`)
            .setLabel('Ẩn')
            .setEmoji('👻')
            .setStyle(room.mode === 'hidden' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_public_${userId}`)
            .setLabel('Công khai')
            .setEmoji('🌐')
            .setStyle(room.mode === 'public' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_lock_${userId}`)
            .setLabel('Khoá')
            .setEmoji('🔒')
            .setStyle(room.mode === 'locked' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_help_${userId}`)
            .setLabel('Hướng dẫn')
            .setEmoji('❓')
            .setStyle(ButtonStyle.Secondary),
    );

    // ── Hàng 2: Quản lý danh sách ──
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`boostvc_togglelist_${userId}`)
            .setLabel(isBlacklist ? 'DS: Blacklist' : 'DS: Whitelist')
            .setEmoji(isBlacklist ? '⛔' : '✅')
            .setStyle(isBlacklist ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`boostvc_add_${userId}`)
            .setLabel('Thêm')
            .setEmoji('➕')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_remove_${userId}`)
            .setLabel('Trừ')
            .setEmoji('➖')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_list_${userId}`)
            .setLabel('Danh sách')
            .setEmoji('📋')
            .setStyle(ButtonStyle.Secondary),
    );

    // ── Hàng 3: Tương tác mic & chat ──
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`boostvc_mute_${userId}`)
            .setLabel('Tắt mic')
            .setEmoji('🔇')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_unmute_${userId}`)
            .setLabel('Mở mic')
            .setEmoji('🔊')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_clearchat_${userId}`)
            .setLabel('Xoá chat')
            .setEmoji('🧹')
            .setStyle(ButtonStyle.Danger),
    );

    // ── Hàng 4: Cấu hình kênh ──
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`boostvc_rename_${userId}`)
            .setLabel('Đổi tên')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_region_${userId}`)
            .setLabel('Đổi Server')
            .setEmoji('🌏')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`boostvc_autolock_${userId}`)
            .setLabel(`Tự khoá: ${room.auto_lock ? 'Bật' : 'Tắt'}`)
            .setEmoji(room.auto_lock ? '🟢' : '🔴')
            .setStyle(room.auto_lock ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row1, row2, row3, row4] };
}

// Lưu message ID bảng điều khiển → xoá khi rời room
const controlPanelMessages = new Map(); // Map<channelId, messageId>

// ═══════════════════════════════════════════════════════════════════════════
// VOICE STATE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleVoiceJoin(channel, userId) {
    const room = db.getBoosterRoomByChannelId(channel.id);
    if (!room || room.user_id !== userId) return;

    // Tự động mở khoá nếu auto_lock = 1
    if (room.auto_lock) {
        try {
            room.mode = 'public';
            db.setBoosterRoomMode(userId, 'public');
            const allMembers = db.getAllBoosterRoomMembers(userId);
            await updateRoomPermissions(channel, room, allMembers);
        } catch (e) {
            console.error('[BoostVC] Error unlocking room on join:', e.message);
        }
    }

    // Gửi bảng điều khiển
    try {
        const oldMsgId = controlPanelMessages.get(channel.id);
        if (oldMsgId) {
            try {
                const old = await channel.messages.fetch(oldMsgId).catch(() => null);
                if (old) await old.delete();
            } catch (e) { /* ignore */ }
        }

        const member = await channel.guild.members.fetch(userId).catch(() => null);
        const panel = createControlPanel(userId, room, member);
        const sent = await channel.send(panel);
        controlPanelMessages.set(channel.id, sent.id);
    } catch (e) {
        console.error('[BoostVC] Error sending control panel:', e.message);
    }
}

async function handleVoiceLeave(channel, userId) {
    const room = db.getBoosterRoomByChannelId(channel.id);
    if (!room) return;

    const isOwner = room.user_id === userId;

    if (isOwner) {
        const msgId = controlPanelMessages.get(channel.id);
        if (msgId) {
            try {
                const msg = await channel.messages.fetch(msgId).catch(() => null);
                if (msg) await msg.delete();
            } catch (e) { /* ignore */ }
            controlPanelMessages.delete(channel.id);
        }
    }

    // Logic Tự Khoá Phòng
    if (room.auto_lock) {
        const ownerInChannel = channel.members.has(room.user_id);
        if (!ownerInChannel) {
            const humanCount = channel.members.filter(m => !m.user.bot).size;
            if (humanCount === 0) {
                try {
                    room.mode = 'locked';
                    db.setBoosterRoomMode(room.user_id, 'locked');
                    const allMembers = db.getAllBoosterRoomMembers(room.user_id);
                    await updateRoomPermissions(channel, room, allMembers);
                } catch (e) {
                    console.error('[BoostVC] Error auto-locking room:', e.message);
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUTTON HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('boostvc_')) return false;

    const parts = customId.split('_');
    const action = parts[1];
    const ownerId = parts[2];

    // Chỉ owner mới được dùng
    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '❌ Chỉ chủ room mới được sử dụng!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const room = db.getBoosterRoom(ownerId);
    if (!room) {
        await interaction.reply({ content: '❌ Không tìm thấy room!', flags: MessageFlags.Ephemeral });
        return true;
    }

    switch (action) {
        case 'add':        return await handleAdd(interaction, ownerId);
        case 'remove':     return await handleRemove(interaction, ownerId);
        case 'list':       return await handleList(interaction, ownerId);
        case 'mute':       return await handleMuteSelect(interaction, ownerId);
        case 'unmute':     return await handleUnmuteSelect(interaction, ownerId);
        case 'hidden':     return await handleSetMode(interaction, ownerId, 'hidden');
        case 'public':     return await handleSetMode(interaction, ownerId, 'public');
        case 'lock':       return await handleSetMode(interaction, ownerId, 'locked');
        case 'rename':     return await handleRename(interaction, ownerId);
        case 'clearchat':  return await handleClearChat(interaction, ownerId);
        case 'region':     return await handleRegionSelect(interaction, ownerId);
        case 'autolock':   return await handleAutoLock(interaction, ownerId);
        case 'togglelist': return await handleToggleListMode(interaction, ownerId);
        case 'help':       return await handleHelp(interaction, ownerId);
        default:           return false;
    }
}

// ── Thêm người ──
async function handleAdd(interaction, ownerId) {
    const modal = new ModalBuilder()
        .setCustomId(`boostvc_modal_add_${ownerId}`)
        .setTitle('➕ Thêm người vào danh sách')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('user_input')
                    .setLabel('Nhập @mention, tên, hoặc ID')
                    .setPlaceholder('VD: rain hoặc 123456789')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
    await interaction.showModal(modal);
    return true;
}

// ── Trừ người ──
async function handleRemove(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const listMode = room.list_mode || 'whitelist';
    const isBlacklist = listMode === 'blacklist';

    const members = db.getBoosterRoomMembers(ownerId, listMode);
    if (members.length === 0) {
        await interaction.reply({ content: `📋 Chưa có ai trong **${isBlacklist ? 'Blacklist' : 'Whitelist'}**!`, flags: MessageFlags.Ephemeral });
        return true;
    }

    const guild = interaction.guild;
    const options = [];
    for (const memberId of members.slice(0, 25)) {
        const member = await guild.members.fetch(memberId).catch(() => null);
        options.push({
            label: member ? (member.displayName || member.user.tag) : memberId,
            value: memberId,
            description: memberId
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`boostvc_remove_select_${ownerId}`)
            .setPlaceholder(`Chọn người để xóa khỏi ${isBlacklist ? 'Blacklist' : 'Whitelist'}...`)
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options)
    );

    await interaction.reply({ content: `➖ Chọn người muốn **xóa khỏi ${isBlacklist ? '⛔ Blacklist' : '✅ Whitelist'}**:`, components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

// ── Danh sách (chỉ owner thấy - Ephemeral) ──
async function handleList(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const listMode = room.list_mode || 'whitelist';
    const isBlacklist = listMode === 'blacklist';
    const modeLabel = { hidden: '👻 Ẩn', public: '🌐 Công khai', locked: '🔒 Khoá' };

    // Lấy đúng list theo list_mode hiện tại
    const members = db.getBoosterRoomMembers(ownerId, listMode);
    // Lấy cả 2 list để hiện số lượng
    const allMembers = db.getAllBoosterRoomMembers(ownerId);

    let desc;
    if (members.length === 0) {
        desc = '*Chưa có ai trong danh sách này.*';
    } else {
        desc = members.map((id, i) => `${i + 1}. <@${id}>`).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(isBlacklist ? '#EF4444' : '#8B5CF6')
        .setTitle(`${isBlacklist ? '⛔ Blacklist' : '✅ Whitelist'} — Hiện đang áp dụng`)
        .setDescription(desc)
        .addFields(
            { name: 'Chế độ kênh', value: modeLabel[room.mode] || '👻 Ẩn', inline: true },
            { name: 'Kiểu DS', value: isBlacklist ? '⛔ Blacklist' : '✅ Whitelist', inline: true },
            { name: 'Số người', value: `${members.length}`, inline: true },
            { name: '✅ Whitelist có', value: `${allMembers.whitelist.length} người`, inline: true },
            { name: '⛔ Blacklist có', value: `${allMembers.blacklist.length} người`, inline: true },
        );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
}

// ── Hướng dẫn chi tiết (chỉ owner thấy) ──
async function handleHelp(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const listMode = room.list_mode || 'whitelist';
    const isBlacklist = listMode === 'blacklist';

    const embed = new EmbedBuilder()
        .setColor('#FF73FA')
        .setTitle('❓ Hướng Dẫn Sử Dụng VIP Room')
        .setDescription(
            `${EMOJI.booster} Cảm ơn bạn đã Boost server! Đây là đặc quyền riêng dành cho bạn 💖\n\n` +
            `**━━━ 🎛️ CÁC CHẾ ĐỘ KÊNH ━━━**\n` +
            `👻 **Ẩn** — Kênh bí mật, chỉ bạn (và Whitelist) thấy\n` +
            `🌐 **Công khai** — Mọi người đều thấy và vào được\n` +
            `🔒 **Khoá** — Mọi người thấy kênh, nhưng chỉ người được phép mới vào được\n\n` +
            `**━━━ 📋 DANH SÁCH THÀNH VIÊN ━━━**\n` +
            `✅ **Whitelist** *(mặc định)* — Người trong DS được ưu tiên:\n` +
            `　• **Ẩn:** Thấy kênh & vào được\n` +
            `　• **Khoá:** Vào được trong khi người ngoài không thể\n` +
            `　• **Công khai:** Bình thường như mọi người\n\n` +
            `⛔ **Blacklist** *(chế độ hiện tại của bạn${isBlacklist ? ' ← đang bật' : ''})* — Người trong DS bị cấm:\n` +
            `　• **Tất cả chế độ:** Không thấy kênh, không vào được\n\n` +
            `**━━━ 🔧 CÁC NÚT CHỨC NĂNG ━━━**\n` +
            `⚡ **DS: Whitelist/Blacklist** — Chuyển đổi chế độ danh sách\n` +
            `➕ **Thêm** — Thêm người vào danh sách\n` +
            `➖ **Trừ** — Xoá người khỏi danh sách\n` +
            `📋 **Danh sách** — Xem DS hiện tại (chỉ bạn thấy)\n\n` +
            `🔇 **Tắt mic** — Tắt mic người trong phòng\n` +
            `🔊 **Mở mic** — Mở lại mic người bị tắt\n` +
            `🧹 **Xoá chat** — Xoá toàn bộ tin nhắn trong kênh\n\n` +
            `✏️ **Đổi tên** — Đặt tên mới cho kênh\n` +
            `🌏 **Đổi Server** — Chọn vùng server (SG, HK, JP...)\n` +
            `🔴/🟢 **Tự khoá** — Tự động khoá phòng khi bạn rời đi\n\n` +
            `**━━━ 💡 MẸO HAY ━━━**\n` +
            `Tag bot hoặc gọi tên *"đại ngỗng"* trong kênh để triệu hồi lại bảng điều khiển nếu bị trôi!`
        )
        .setFooter({ text: 'VIP Room • Đặc quyền Server Booster' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
}

// ── Mute select ──
async function handleMuteSelect(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const channel = interaction.guild.channels.cache.get(room.channel_id);
    if (!channel) {
        await interaction.reply({ content: '❌ Không tìm thấy voice channel!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const voiceMembers = channel.members.filter(m => m.id !== ownerId);
    if (voiceMembers.size === 0) {
        await interaction.reply({ content: '🔇 Không có ai trong room để mute!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const options = voiceMembers.map(m => ({
        label: m.displayName,
        value: m.id,
        description: m.user.tag
    }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`boostvc_mute_select_${ownerId}`)
            .setPlaceholder('Chọn người để tắt mic...')
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options)
    );

    await interaction.reply({ content: '🔇 Chọn người muốn **tắt mic**:', components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

// ── Unmute select ──
async function handleUnmuteSelect(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const channel = interaction.guild.channels.cache.get(room.channel_id);
    if (!channel) {
        await interaction.reply({ content: '❌ Không tìm thấy voice channel!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const mutedMembers = channel.members.filter(m => m.id !== ownerId && m.voice.serverMute);
    if (mutedMembers.size === 0) {
        await interaction.reply({ content: '🔊 Không có ai bị mute!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const options = mutedMembers.map(m => ({
        label: m.displayName,
        value: m.id,
        description: `${m.user.tag} (đang bị mute)`
    }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`boostvc_unmute_select_${ownerId}`)
            .setPlaceholder('Chọn người để mở mic...')
            .setMinValues(1)
            .setMaxValues(Math.min(options.length, 10))
            .addOptions(options)
    );

    await interaction.reply({ content: '🔊 Chọn người muốn **mở mic**:', components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

// ── Set mode (hidden/public/locked) ──
async function handleSetMode(interaction, ownerId, newMode) {
    const room = db.getBoosterRoom(ownerId);
    const channel = interaction.guild.channels.cache.get(room.channel_id);
    if (!channel) {
        await interaction.reply({ content: '❌ Không tìm thấy voice channel!', flags: MessageFlags.Ephemeral });
        return true;
    }

    // Defer NGAY để tránh lỗi Unknown Interaction (10062) — Discord timeout 3s
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const allMembers = db.getAllBoosterRoomMembers(ownerId);
    room.mode = newMode;

    try {
        await updateRoomPermissions(channel, room, allMembers);
        db.setBoosterRoomMode(ownerId, newMode);

        const modeLabel = { hidden: '👻 Ẩn', public: '🌐 Công khai', locked: '🔒 Khoá' };
        await interaction.editReply({
            content: `✅ Đã chuyển sang chế độ **${modeLabel[newMode]}**!`
        });

        await refreshControlPanel(interaction.channel, ownerId);
    } catch (e) {
        console.error('[BoostVC] Error setting mode:', e.message);
        await interaction.editReply({ content: '❌ Lỗi khi thay đổi chế độ!' });
    }

    return true;
}

// ── Toggle Whitelist ↔ Blacklist ──
async function handleToggleListMode(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    if (!room) {
        await interaction.reply({ content: '❌ Không tìm thấy room!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const channel = interaction.guild.channels.cache.get(room.channel_id);
    const currentMode = room.list_mode || 'whitelist';
    const newMode = currentMode === 'whitelist' ? 'blacklist' : 'whitelist';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    db.setBoosterRoomListMode(ownerId, newMode);
    room.list_mode = newMode;

    // Áp dụng permission mới với cả 2 list (reset và áp dụng list mới)
    if (channel) {
        const allMembers = db.getAllBoosterRoomMembers(ownerId);
        await updateRoomPermissions(channel, room, allMembers);
    }

    // Hiện số người trong list mới được kích hoạt
    const allMembers = db.getAllBoosterRoomMembers(ownerId);
    const activeCount = newMode === 'blacklist' ? allMembers.blacklist.length : allMembers.whitelist.length;
    const otherCount = newMode === 'blacklist' ? allMembers.whitelist.length : allMembers.blacklist.length;
    const otherLabel = newMode === 'blacklist' ? 'Whitelist' : 'Blacklist';

    const label = newMode === 'blacklist'
        ? `⛔ **Blacklist** đang áp dụng (${activeCount} người bị chặn)`
        : `✅ **Whitelist** đang áp dụng (${activeCount} người được ưu tiên)`;

    await interaction.editReply({
        content: `✅ Đã chuyển sang **${label}**\n\n` +
            `*${otherLabel} cũ vẫn được lưu riêng (${otherCount} người), chỉ không áp dụng.*`
    });
    await refreshControlPanel(interaction.channel, ownerId);
    return true;
}

// ── Bật Tắt Tự Động Khoá ──
async function handleAutoLock(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    if (!room) {
        await interaction.reply({ content: '❌ Không tìm thấy room!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const newState = !room.auto_lock;
    db.setBoosterRoomAutoLock(ownerId, newState);

    await interaction.reply({
        content: `✅ Đã **${newState ? 'Bật' : 'Tắt'}** tính năng Tự Động Khoá phòng!`,
        flags: MessageFlags.Ephemeral
    });

    await refreshControlPanel(interaction.channel, ownerId);
    return true;
}

// ── Đổi Server Region ──
const VOICE_REGIONS = [
    { label: '🔄 Tự động (Discord chọn)', value: 'auto', description: 'Discord tự chọn server tốt nhất' },
    { label: '🇸🇬 Singapore', value: 'singapore', description: 'Đông Nam Á' },
    { label: '🇭🇰 Hong Kong', value: 'hongkong', description: 'Đông Á' },
    { label: '🇯🇵 Japan', value: 'japan', description: 'Nhật Bản' },
    { label: '🇦🇺 Sydney', value: 'sydney', description: 'Châu Úc' },
    { label: '🇺🇸 US West', value: 'us-west', description: 'Bờ Tây Mỹ' },
    { label: '🇺🇸 US East', value: 'us-east', description: 'Bờ Đông Mỹ' },
    { label: '🇧🇷 Brazil', value: 'brazil', description: 'Nam Mỹ' },
    { label: '🇮🇳 India', value: 'india', description: 'Ấn Độ' },
    { label: '🇷🇺 Russia', value: 'russia', description: 'Nga' },
];

async function handleRegionSelect(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const channel = interaction.guild.channels.cache.get(room.channel_id);
    if (!channel) {
        await interaction.reply({ content: '❌ Không tìm thấy voice channel!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const currentRegion = channel.rtcRegion || 'auto';
    const options = VOICE_REGIONS.map(r => ({ ...r, default: r.value === currentRegion }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`boostvc_region_select_${ownerId}`)
            .setPlaceholder(`Server hiện tại: ${VOICE_REGIONS.find(r => r.value === currentRegion)?.label || '🔄 Tự động'}`)
            .addOptions(options)
    );

    await interaction.reply({
        content: `🌏 **Chọn server khu vực:**\nHiện tại: **${VOICE_REGIONS.find(r => r.value === currentRegion)?.label || '🔄 Tự động'}**`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
    return true;
}

// ── Đổi tên ──
async function handleRename(interaction, ownerId) {
    const modal = new ModalBuilder()
        .setCustomId(`boostvc_modal_rename_${ownerId}`)
        .setTitle('✏️ Đổi tên room')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('room_name')
                    .setLabel('Tên room mới (tối đa 30 ký tự)')
                    .setPlaceholder('VD: 🎮 Phòng game')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(30)
                    .setRequired(true)
            )
        );
    await interaction.showModal(modal);
    return true;
}

// ── Xoá chat ──
async function handleClearChat(interaction, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    const channel = interaction.guild.channels.cache.get(room.channel_id);
    if (!channel) {
        await interaction.reply({ content: '❌ Không tìm thấy voice channel!', flags: MessageFlags.Ephemeral });
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        let totalDeleted = 0;
        let fetched;

        do {
            fetched = await channel.messages.fetch({ limit: 100 });
            if (fetched.size === 0) break;

            const recent = fetched.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
            if (recent.size > 0) {
                await channel.bulkDelete(recent, true);
                totalDeleted += recent.size;
            }

            if (recent.size < fetched.size) break;
        } while (fetched.size === 100);

        await interaction.editReply({
            content: totalDeleted > 0
                ? `🧹 Đã xoá **${totalDeleted}** tin nhắn trong chatroom!`
                : '📭 Không có tin nhắn nào để xoá!'
        });

        // Gửi lại control panel vì nó cũng bị xoá
        const updatedRoom = db.getBoosterRoom(ownerId);
        if (updatedRoom) {
            const ownerMember = await channel.guild.members.fetch(ownerId).catch(() => null);
            const panel = createControlPanel(ownerId, updatedRoom, ownerMember);
            const sent = await channel.send(panel);
            controlPanelMessages.set(channel.id, sent.id);
        }
    } catch (e) {
        console.error('[BoostVC] Error clearing chat:', e.message);
        await interaction.editReply({ content: '❌ Lỗi khi xoá tin nhắn!' });
    }

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// SELECT MENU HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleSelectMenu(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('boostvc_')) return false;

    const parts = customId.split('_');
    const action = parts[1]; // remove, mute, unmute, region
    const ownerId = parts[3];

    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '❌ Chỉ chủ room!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const room = db.getBoosterRoom(ownerId);
    if (!room) {
        await interaction.reply({ content: '❌ Room không tồn tại!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const selectedIds = interaction.values;
    const channel = interaction.guild.channels.cache.get(room.channel_id);

    if (action === 'remove') {
        // Xoá người khỏi danh sách + xoá permission overwrite
        const removed = [];
        for (const id of selectedIds) {
            db.removeBoosterRoomMember(ownerId, id);
            if (channel) {
                try {
                    await channel.permissionOverwrites.delete(id);
                } catch (e) { /* ignore */ }
            }
            removed.push(`<@${id}>`);
        }

        // Cập nhật lại permission với danh sách mới
        if (channel) {
            const updatedMembers = db.getBoosterRoomMembers(ownerId);
            await updateRoomPermissions(channel, room, updatedMembers);
        }

        await interaction.update({
            content: `✅ Đã xoá ${removed.join(', ')} khỏi danh sách!`,
            components: []
        });
    } else if (action === 'mute') {
        const muted = [];
        for (const id of selectedIds) {
            const member = channel?.members.get(id);
            if (member) {
                try {
                    await member.voice.setMute(true, 'Boost Room owner mute');
                    muted.push(`<@${id}>`);
                } catch (e) { /* ignore */ }
            }
        }
        await interaction.update({
            content: muted.length > 0 ? `🔇 Đã tắt mic: ${muted.join(', ')}` : '❌ Không tắt mic được ai!',
            components: []
        });
    } else if (action === 'unmute') {
        const unmuted = [];
        for (const id of selectedIds) {
            const member = channel?.members.get(id);
            if (member) {
                try {
                    await member.voice.setMute(false, 'Boost Room owner unmute');
                    unmuted.push(`<@${id}>`);
                } catch (e) { /* ignore */ }
            }
        }
        await interaction.update({
            content: unmuted.length > 0 ? `🔊 Đã mở mic: ${unmuted.join(', ')}` : '❌ Không mở mic được ai!',
            components: []
        });
    } else if (action === 'region') {
        const selectedRegion = selectedIds[0];
        const rtcRegion = selectedRegion === 'auto' ? null : selectedRegion;
        try {
            await channel.setRTCRegion(rtcRegion, 'VIP Room owner đổi server');
            const regionLabel = VOICE_REGIONS.find(r => r.value === selectedRegion)?.label || selectedRegion;
            await interaction.update({
                content: `✅ Đã chuyển server sang **${regionLabel}**!`,
                components: []
            });
        } catch (e) {
            console.error('[BoostVC] Error setting region:', e.message);
            await interaction.update({
                content: '❌ Không thể đổi server! Kiểm tra quyền của bot.',
                components: []
            });
        }
    }

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleModal(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('boostvc_modal_')) return false;

    const parts = customId.split('_');
    const action = parts[2];
    const ownerId = parts[3];

    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '❌ Chỉ chủ room!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const room = db.getBoosterRoom(ownerId);
    if (!room) {
        await interaction.reply({ content: '❌ Room không tồn tại!', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'add') {
        const input = interaction.fields.getTextInputValue('user_input').trim();
        const guild = interaction.guild;

        let targetMember = null;

        const mentionMatch = input.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            targetMember = await guild.members.fetch(mentionMatch[1]).catch(() => null);
        }

        if (!targetMember && /^\d{17,20}$/.test(input)) {
            targetMember = await guild.members.fetch(input).catch(() => null);
        }

        if (!targetMember) {
            const allMembers = await guild.members.fetch({ query: input, limit: 1 });
            targetMember = allMembers.first() || null;
        }

        if (!targetMember) {
            await interaction.reply({ content: `❌ Không tìm thấy user **${input}**!`, flags: MessageFlags.Ephemeral });
            return true;
        }

        if (targetMember.id === ownerId) {
            await interaction.reply({ content: '❌ Bạn là chủ room rồi!', flags: MessageFlags.Ephemeral });
            return true;
        }

        // Thêm vào đúng danh sách theo list_mode hiện tại
        const listMode = room.list_mode || 'whitelist';
        db.addBoosterRoomMember(ownerId, targetMember.id, listMode);

        // Cập nhật permission với cả 2 list
        const channel = guild.channels.cache.get(room.channel_id);
        if (channel) {
            const allMembers = db.getAllBoosterRoomMembers(ownerId);
            await updateRoomPermissions(channel, room, allMembers);
        }

        const addedLabel = listMode === 'blacklist'
            ? `⛔ Đã thêm **${targetMember.displayName}** vào **Blacklist** — họ sẽ không thấy kênh này!`
            : `✅ Đã thêm **${targetMember.displayName}** vào **Whitelist**!`;

        await interaction.reply({ content: addedLabel, flags: MessageFlags.Ephemeral });

    } else if (action === 'rename') {
        const newName = interaction.fields.getTextInputValue('room_name').trim();
        if (!newName) {
            await interaction.reply({ content: '❌ Tên không được trống!', flags: MessageFlags.Ephemeral });
            return true;
        }

        const channel = interaction.guild.channels.cache.get(room.channel_id);
        if (channel) {
            await channel.setName(newName).catch(() => {});
        }
        db.setBoosterRoomName(ownerId, newName);

        await interaction.reply({
            content: `✅ Đã đổi tên room thành **${newName}**!`,
            flags: MessageFlags.Ephemeral
        });

        await refreshControlPanel(interaction.channel, ownerId);
    }

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER — Refresh control panel
// ═══════════════════════════════════════════════════════════════════════════

async function refreshControlPanel(channel, ownerId) {
    const room = db.getBoosterRoom(ownerId);
    if (!room) return;

    const msgId = controlPanelMessages.get(channel.id);
    if (!msgId) return;

    try {
        const member = await channel.guild.members.fetch(ownerId).catch(() => null);
        const msg = await channel.messages.fetch(msgId).catch(() => null);
        if (msg) {
            const panel = createControlPanel(ownerId, room, member);
            await msg.edit(panel);
        }
    } catch (e) { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT PANEL BUTTONS (booster_create / booster_delete)
// Dùng static customId → vẫn hoạt động sau khi bot restart
// ═══════════════════════════════════════════════════════════════════════════

const BOOSTER_ROLE_ID = '740457614470545408';
const OWNER_BYPASS_ID = '395151484179841024'; // Owner bypass booster check

async function handlePanelButton(interaction) {
    const customId = interaction.customId;
    if (customId !== 'booster_create' && customId !== 'booster_delete') return false;

    const member = interaction.member;
    const userId = interaction.user.id;
    const guild = interaction.guild;
    const guildId = guild.id;

    // Kiểm tra role Server Booster (bypass cho owner và user trong list VIP)
    const vipUsers = db.getBoosterVipUsers ? db.getBoosterVipUsers() : [];
    const isBooster = member.roles.cache.has(BOOSTER_ROLE_ID) || userId === OWNER_BYPASS_ID || vipUsers.includes(userId);
    if (!isBooster) {
        await interaction.reply({
            content: '❌ Chỉ **Server Booster** mới được sử dụng tính năng này!',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (customId === 'booster_create') {
        // ── Tạo VIP Room ──
        const existingRoom = db.getBoosterRoom(userId);
        if (existingRoom) {
            const channel = guild.channels.cache.get(existingRoom.channel_id);
            if (channel) {
                await interaction.reply({
                    content: `🎙️ Bạn đã có VIP Room: <#${existingRoom.channel_id}>\nNhấn **Xoá VIP Room** để xoá room cũ trước.`,
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            // Channel không còn tồn tại → xoá data cũ
            db.deleteBoosterRoom(userId);
        }

        const categoryId = db.getBoostCategoryId(guildId);
        if (!categoryId) {
            await interaction.reply({
                content: '❌ Admin chưa set category cho VIP Room!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        const category = guild.channels.cache.get(categoryId);
        if (!category) {
            await interaction.reply({
                content: '❌ Category không tồn tại! Hãy liên hệ Admin.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        try {
            const { ChannelType, PermissionFlagsBits } = require('discord.js');
            const roomName = `[VIP] ${member.displayName}`;

            const voiceChannel = await guild.channels.create({
                name: roomName,
                type: ChannelType.GuildVoice,
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                    },
                    {
                        id: userId, // Booster owner
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.MoveMembers
                        ]
                    }
                ]
            });

            db.createBoosterRoom(userId, voiceChannel.id, guildId, roomName);

            await interaction.reply({
                content: `✅ Đã tạo VIP Room: <#${voiceChannel.id}>\n\n📌 Vào room để mở **Bảng Điều Khiển** quản lý room.\n👻 Chế độ mặc định: **Ẩn** (chỉ bạn thấy).`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('[Booster Panel] Error creating room:', error);
            await interaction.reply({
                content: '❌ Không thể tạo VIP Room! Kiểm tra quyền của bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        return true;

    } else if (customId === 'booster_delete') {
        // ── Xoá VIP Room ──
        const room = db.getBoosterRoom(userId);
        if (!room) {
            await interaction.reply({
                content: '❌ Bạn chưa có VIP Room nào!',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        try {
            const channel = guild.channels.cache.get(room.channel_id);
            if (channel) {
                await channel.delete('Booster xoá VIP Room qua panel');
            }

            db.deleteBoosterRoom(userId);

            await interaction.reply({
                content: '✅ Đã xoá VIP Room! Bạn có thể tạo room mới bất cứ lúc nào.',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('[Booster Panel] Error deleting room:', error);
            await interaction.reply({
                content: '❌ Không thể xoá room! Kiểm tra quyền của bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        return true;
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT MENTION HANDLER — Gọi tên/tag bot để mở lại bảng điều khiển
// ═══════════════════════════════════════════════════════════════════════════

const BOT_NAME_KEYWORDS = [
    'bot',
    'đại ngỗng', 'dai ngong', 'dai ngỗng',
    'ngỗng ngu', 'ngỗg ngu', 'ngong ngu', 'ngog ngu',
    'ngỗng', 'ngỗg', 'ngong', 'ngog',
    'ngong~', 'ngog~',
];

function isBotMentioned(message, client) {
    if (message.mentions.has(client.user.id)) return true;
    const content = message.content.toLowerCase().trim();
    return BOT_NAME_KEYWORDS.some(keyword => content.includes(keyword));
}

async function handleBotMention(message, client) {
    if (!isBotMentioned(message, client)) return false;

    const channel = message.channel;
    const userId = message.author.id;

    const room = db.getBoosterRoomByChannelId(channel.id);
    if (!room) return false;

    if (room.user_id !== userId) return false;

    const guild = message.guild;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.voice.channel || member.voice.channel.id !== channel.id) return false;

    try {
        const oldMsgId = controlPanelMessages.get(channel.id);
        if (oldMsgId) {
            try {
                const old = await channel.messages.fetch(oldMsgId).catch(() => null);
                if (old) await old.delete();
            } catch (e) { /* ignore */ }
        }

        const panel = createControlPanel(userId, room, member);
        const sent = await channel.send(panel);
        controlPanelMessages.set(channel.id, sent.id);

        try { await message.delete(); } catch (e) { /* ignore */ }

        console.log(`[BoostVC] Control panel reopened by ${member.displayName} via bot mention`);
    } catch (e) {
        console.error('[BoostVC] Error handling bot mention:', e.message);
    }

    return true;
}

module.exports = {
    handleButton,
    handleSelectMenu,
    handleModal,
    handleVoiceJoin,
    handleVoiceLeave,
    handlePanelButton,
    handleBotMention,
    createControlPanel,
    controlPanelMessages
};
