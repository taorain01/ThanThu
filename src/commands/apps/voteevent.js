/**
 * ?voteevent - Bình chọn lịch sự kiện Guild (Thiết kế mới)
 * 
 * Sử dụng button navigation để tránh giới hạn 5 action rows:
 * - Main embed: tổng quan + kết quả live
 * - 1 row buttons: [🍽️ Yến Tiệc] [⚔️ Boss Solo] [🏆 PvP Solo] [📊 Kết quả] [🛑 Kết thúc]
 * - Click button → ephemeral reply với dropdown tương ứng
 * 
 * Usage:
 * - ?voteevent - Tạo bình chọn mới (24h)
 * - ?voteevent <hours>h - Tạo bình chọn với thời gian tùy chỉnh
 * - ?voteevent end - Kết thúc sớm
 * - ?voteevent result - Xem kết quả
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════
// CẤU HÌNH
// ═══════════════════════════════════════════════════════════════════════════

// Khung giờ 18h-23h, mỗi 30 phút
const TIME_OPTIONS = [
    { label: '18:00', value: '18:00', emoji: '🕕' },
    { label: '18:30', value: '18:30', emoji: '🕡' },
    { label: '19:00', value: '19:00', emoji: '🕖' },
    { label: '19:30', value: '19:30', emoji: '🕢' },
    { label: '20:00', value: '20:00', emoji: '🕗' },
    { label: '20:30', value: '20:30', emoji: '🕣' },
    { label: '21:00', value: '21:00', emoji: '🕘' },
    { label: '21:30', value: '21:30', emoji: '🕤' },
    { label: '22:00', value: '22:00', emoji: '🕙' },
    { label: '22:30', value: '22:30', emoji: '🕥' },
    { label: '23:00', value: '23:00', emoji: '🕚' },
];

// Ngày trong tuần
const DAY_OPTIONS = [
    { label: 'Thứ 2', value: 'thu2', emoji: '📅' },
    { label: 'Thứ 3', value: 'thu3', emoji: '📅' },
    { label: 'Thứ 4', value: 'thu4', emoji: '📅' },
    { label: 'Thứ 5', value: 'thu5', emoji: '📅' },
    { label: 'Thứ 6', value: 'thu6', emoji: '📅' },
    { label: 'Thứ 7', value: 'thu7', emoji: '📅' },
    { label: 'Chủ nhật', value: 'cn', emoji: '🌟' },
];

// Sự kiện Guild
const EVENTS = [
    { id: 'yentiec', name: 'Yến Tiệc', emoji: '🍽️', hasDay: false, defaultTime: '21:00' },
    { id: 'boss', name: 'Boss Solo', emoji: '⚔️', hasDay: true, defaultTime: '20:00', defaultDays: ['thu4', 'cn'] },
    { id: 'pvp', name: 'PvP Solo', emoji: '🏆', hasDay: true, defaultTime: '20:00', defaultDays: ['thu6', 'cn'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// LƯU TRỮ
// ═══════════════════════════════════════════════════════════════════════════

const activePolls = new Map();  // guildId -> pollData
const pollVotes = new Map();    // guildId -> { yentiec_time: {userId: value}, boss_time: {}, boss_days: {}, ... }

// ═══════════════════════════════════════════════════════════════════════════
// HÀM TIỆN ÍCH
// ═══════════════════════════════════════════════════════════════════════════

function getDayName(v) {
    return DAY_OPTIONS.find(d => d.value === v)?.label || v;
}

function createProgressBar(pct, len = 8) {
    const f = Math.round((pct / 100) * len);
    return '█'.repeat(f) + '░'.repeat(len - f);
}

/**
 * Tính kết quả cho 1 key vote (ví dụ: 'yentiec_time', 'boss_days')
 */
function calculateResults(guildId, voteKey) {
    const gv = pollVotes.get(guildId);
    if (!gv || !gv[voteKey]) return { results: [], total: 0 };

    const counts = {};
    for (const value of Object.values(gv[voteKey])) {
        // Nếu là days (multi-select), tách từng ngày ra đếm riêng
        if (voteKey.endsWith('_days')) {
            for (const d of value.split(',')) {
                counts[d] = (counts[d] || 0) + 1;
            }
        } else {
            counts[value] = (counts[value] || 0) + 1;
        }
    }

    const total = Object.keys(gv[voteKey]).length;
    const results = Object.entries(counts)
        .map(([value, count]) => ({
            value,
            count,
            pct: total > 0 ? Math.round((count / total) * 100) : 0
        }))
        .sort((a, b) => b.count - a.count);

    return { results, total };
}

/**
 * Đếm tổng số người tham gia vote
 */
function countTotalVoters(guildId) {
    const gv = pollVotes.get(guildId);
    if (!gv) return 0;
    const voters = new Set();
    for (const key of Object.keys(gv)) {
        if (gv[key]) Object.keys(gv[key]).forEach(id => voters.add(id));
    }
    return voters.size;
}

// ═══════════════════════════════════════════════════════════════════════════
// TẠO EMBED VÀ COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tạo embed chính (hiển thị trên channel)
 */
function createPollEmbed(guildId) {
    const poll = activePolls.get(guildId);
    if (!poll) return null;

    const resultLines = [];
    for (const event of EVENTS) {
        const { results: timeResults } = calculateResults(guildId, `${event.id}_time`);
        const topTime = timeResults.length > 0 ? timeResults[0].value : event.defaultTime;
        const timeInfo = timeResults.length > 0 ? `(${timeResults[0].count} vote)` : '_(mặc định)_';

        if (event.hasDay) {
            const { results: dayResults } = calculateResults(guildId, `${event.id}_days`);
            let dayText;
            if (dayResults.length >= 2) {
                dayText = `${getDayName(dayResults[0].value)} + ${getDayName(dayResults[1].value)}`;
            } else if (dayResults.length === 1) {
                dayText = `${getDayName(dayResults[0].value)} + ...`;
            } else {
                dayText = event.defaultDays.map(getDayName).join(' + ') + ' _(mặc định)_';
            }
            resultLines.push(`${event.emoji} **${event.name}**: **${topTime}** ${timeInfo}`);
            resultLines.push(`　　📅 ${dayText}`);
        } else {
            resultLines.push(`${event.emoji} **${event.name}**: **${topTime}** ${timeInfo} _(mỗi ngày)_`);
        }
    }

    return new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📊 BÌNH CHỌN LỊCH SỰ KIỆN GUILD')
        .setDescription([
            '**Kết quả hiện tại:**',
            '',
            ...resultLines,
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
            '👇 **Bấm nút bên dưới để vote cho từng sự kiện**',
        ].join('\n'))
        .addFields(
            { name: '⏰ Kết thúc', value: `<t:${Math.floor(poll.endTime / 1000)}:R>`, inline: true },
            { name: '👥 Đã vote', value: `${countTotalVoters(guildId)} người`, inline: true }
        )
        .setFooter({ text: `Tạo bởi ${poll.creatorName}` })
        .setTimestamp();
}

/**
 * Tạo 1 row buttons cho main message
 */
function createMainButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('voteevent_btn_yentiec')
                .setLabel('Yến Tiệc')
                .setEmoji('🍽️')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('voteevent_btn_boss')
                .setLabel('Boss Solo')
                .setEmoji('⚔️')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('voteevent_btn_pvp')
                .setLabel('PvP Solo')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('voteevent_result')
                .setLabel('Kết quả')
                .setEmoji('📊')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('voteevent_end')
                .setLabel('Kết thúc')
                .setEmoji('🛑')
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

/**
 * Tạo embed kết quả chi tiết
 */
function createResultEmbed(guildId) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 KẾT QUẢ CHI TIẾT BÌNH CHỌN')
        .setTimestamp();

    const lines = [];

    for (const event of EVENTS) {
        lines.push(`\n${event.emoji} **${event.name}**`);

        // Giờ
        const { results: timeResults } = calculateResults(guildId, `${event.id}_time`);
        if (timeResults.length === 0) {
            lines.push(`　⏰ Giờ: _chưa có vote_ (mặc định: ${event.defaultTime})`);
        } else {
            for (const r of timeResults.slice(0, 3)) {
                const crown = r === timeResults[0] ? ' 👑' : '';
                lines.push(`　${r.value} ${createProgressBar(r.pct)} ${r.count} (${r.pct}%)${crown}`);
            }
        }

        // Ngày (nếu có)
        if (event.hasDay) {
            const { results: dayResults } = calculateResults(guildId, `${event.id}_days`);
            if (dayResults.length === 0) {
                lines.push(`　📅 Ngày: _chưa có vote_ (mặc định: ${event.defaultDays.map(getDayName).join(' + ')})`);
            } else {
                for (const r of dayResults) {
                    const star = dayResults.indexOf(r) < 2 ? ' ⭐' : '';
                    lines.push(`　${getDayName(r.value)} ${createProgressBar(r.pct)} ${r.count} (${r.pct}%)${star}`);
                }
            }
        }
    }

    embed.setDescription(lines.join('\n'));
    embed.setFooter({ text: `👥 ${countTotalVoters(guildId)} người tham gia` });
    return embed;
}

// ═══════════════════════════════════════════════════════════════════════════
// BUTTON HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function handleButton(interaction) {
    const guildId = interaction.guild.id;
    const customId = interaction.customId;

    // ── Nút mở voting cho Yến Tiệc ──
    if (customId === 'voteevent_btn_yentiec') {
        if (!activePolls.has(guildId)) {
            return interaction.reply({ content: '❌ Bình chọn đã kết thúc!', ephemeral: true });
        }
        const event = EVENTS.find(e => e.id === 'yentiec');
        const menu = new StringSelectMenuBuilder()
            .setCustomId('voteevent_yentiec_time')
            .setPlaceholder(`🍽️ Chọn giờ Yến Tiệc (hiện tại: ${event.defaultTime})`)
            .addOptions(TIME_OPTIONS.map(t => ({
                label: t.value === event.defaultTime ? `⭐ ${t.label} (hiện tại)` : t.label,
                value: t.value,
                emoji: t.emoji,
            })));

        return interaction.reply({
            content: '🍽️ **Chọn giờ cho Yến Tiệc** (mỗi ngày):',
            components: [new ActionRowBuilder().addComponents(menu)],
            ephemeral: true
        });
    }

    // ── Nút mở voting cho Boss Solo ──
    if (customId === 'voteevent_btn_boss') {
        if (!activePolls.has(guildId)) {
            return interaction.reply({ content: '❌ Bình chọn đã kết thúc!', ephemeral: true });
        }
        const event = EVENTS.find(e => e.id === 'boss');

        const timeMenu = new StringSelectMenuBuilder()
            .setCustomId('voteevent_boss_time')
            .setPlaceholder(`⚔️ Chọn giờ Boss Solo (hiện tại: ${event.defaultTime})`)
            .addOptions(TIME_OPTIONS.map(t => ({
                label: t.value === event.defaultTime ? `⭐ ${t.label} (hiện tại)` : t.label,
                value: t.value,
                emoji: t.emoji,
            })));

        const dayMenu = new StringSelectMenuBuilder()
            .setCustomId('voteevent_boss_days')
            .setPlaceholder(`📅 Chọn 2 ngày (hiện tại: ${event.defaultDays.map(getDayName).join(' + ')})`)
            .setMinValues(2)
            .setMaxValues(2)
            .addOptions(DAY_OPTIONS.map(d => ({
                label: event.defaultDays.includes(d.value) ? `⭐ ${d.label} (hiện tại)` : d.label,
                value: d.value,
                emoji: d.emoji,
            })));

        return interaction.reply({
            content: '⚔️ **Chọn giờ và 2 ngày cho Boss Solo:**',
            components: [
                new ActionRowBuilder().addComponents(timeMenu),
                new ActionRowBuilder().addComponents(dayMenu),
            ],
            ephemeral: true
        });
    }

    // ── Nút mở voting cho PvP Solo ──
    if (customId === 'voteevent_btn_pvp') {
        if (!activePolls.has(guildId)) {
            return interaction.reply({ content: '❌ Bình chọn đã kết thúc!', ephemeral: true });
        }
        const event = EVENTS.find(e => e.id === 'pvp');

        const timeMenu = new StringSelectMenuBuilder()
            .setCustomId('voteevent_pvp_time')
            .setPlaceholder(`🏆 Chọn giờ PvP Solo (hiện tại: ${event.defaultTime})`)
            .addOptions(TIME_OPTIONS.map(t => ({
                label: t.value === event.defaultTime ? `⭐ ${t.label} (hiện tại)` : t.label,
                value: t.value,
                emoji: t.emoji,
            })));

        const dayMenu = new StringSelectMenuBuilder()
            .setCustomId('voteevent_pvp_days')
            .setPlaceholder(`📅 Chọn 2 ngày (hiện tại: ${event.defaultDays.map(getDayName).join(' + ')})`)
            .setMinValues(2)
            .setMaxValues(2)
            .addOptions(DAY_OPTIONS.map(d => ({
                label: event.defaultDays.includes(d.value) ? `⭐ ${d.label} (hiện tại)` : d.label,
                value: d.value,
                emoji: d.emoji,
            })));

        return interaction.reply({
            content: '🏆 **Chọn giờ và 2 ngày cho PvP Solo:**',
            components: [
                new ActionRowBuilder().addComponents(timeMenu),
                new ActionRowBuilder().addComponents(dayMenu),
            ],
            ephemeral: true
        });
    }

    // ── Nút xem kết quả ──
    if (customId === 'voteevent_result') {
        return interaction.reply({ embeds: [createResultEmbed(guildId)], ephemeral: true });
    }

    // ── Nút kết thúc ──
    if (customId === 'voteevent_end') {
        const poll = activePolls.get(guildId);
        if (!poll) {
            return interaction.reply({ content: '❌ Không có bình chọn!', ephemeral: true });
        }
        const hasPermission = interaction.member.roles.cache.some(r => r.name === 'Quản Lý') ||
            (poll.creatorId === interaction.user.id);
        if (!hasPermission) {
            return interaction.reply({ content: '❌ Bạn không có quyền kết thúc!', ephemeral: true });
        }
        await endPoll(interaction.client, guildId, interaction.channel);
        return interaction.reply({ content: '✅ Đã kết thúc bình chọn!', ephemeral: true });
    }

    // ── Fallback cho buttons cũ (từ message cache) ──
    if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: '❌ Bình chọn này đã hết hạn!', ephemeral: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SELECT MENU HANDLER (vote từ dropdown)
// ═══════════════════════════════════════════════════════════════════════════

async function handleVote(interaction) {
    // Acknowledge NGAY LẬP TỨC để tránh timeout
    try {
        await interaction.deferUpdate();
    } catch (e) {
        console.error('[voteevent] deferUpdate failed:', e);
        return;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const customId = interaction.customId;

    if (!activePolls.has(guildId)) return;

    // Parse customId: voteevent_<eventId>_<type>
    const match = customId.match(/^voteevent_(\w+)_(time|days)$/);
    if (!match) return;

    const eventId = match[1]; // yentiec, boss, pvp
    const voteType = match[2]; // time, days
    const voteKey = `${eventId}_${voteType}`;

    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    const gv = pollVotes.get(guildId);
    if (!gv[voteKey]) gv[voteKey] = {};

    if (voteType === 'days') {
        const selectedDays = interaction.values.sort();
        gv[voteKey][userId] = selectedDays.join(',');
    } else {
        gv[voteKey][userId] = interaction.values[0];
    }

    // Cập nhật main embed
    try {
        const poll = activePolls.get(guildId);
        if (poll?.messageId) {
            const channel = await interaction.client.channels.fetch(poll.channelId);
            const message = await channel.messages.fetch(poll.messageId);
            await message.edit({
                embeds: [createPollEmbed(guildId)],
                components: createMainButtons()
            });
        }
    } catch (e) {
        console.error('[voteevent] Không thể cập nhật embed:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// KẾT THÚC POLL
// ═══════════════════════════════════════════════════════════════════════════

async function endPoll(client, guildId, channel) {
    const poll = activePolls.get(guildId);
    if (!poll) return;
    if (poll.timeout) clearTimeout(poll.timeout);

    // Disable message gốc
    try {
        const ch = await client.channels.fetch(poll.channelId);
        const msg = await ch.messages.fetch(poll.messageId);
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('📊 BÌNH CHỌN LỊCH SỰ KIỆN ĐÃ KẾT THÚC').setTimestamp()],
            components: []
        });
    } catch (e) { }

    // Gửi kết quả
    await channel.send({ embeds: [createResultEmbed(guildId)] });

    activePolls.delete(guildId);
    pollVotes.delete(guildId);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTE COMMAND
// ═══════════════════════════════════════════════════════════════════════════

async function execute(message, args) {
    const guildId = message.guild.id;

    if (!message.member.roles.cache.some(r => r.name === 'Quản Lý' || r.name === 'Kỳ Cựu')) {
        return message.reply('❌ Bạn cần role **Quản Lý** hoặc **Kỳ Cựu**!');
    }

    // ?voteevent end
    if (args[0] === 'end') {
        if (!activePolls.has(guildId)) return message.reply('❌ Không có bình chọn!');
        await endPoll(message.client, guildId, message.channel);
        return;
    }

    // ?voteevent result
    if (args[0] === 'result') {
        return message.reply({ embeds: [createResultEmbed(guildId)] });
    }

    // Kiểm tra đã có poll
    if (activePolls.has(guildId)) {
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?voteevent end` để kết thúc.');
    }

    // Parse thời gian
    let hours = 24;
    if (args[0]?.match(/^(\d+)h$/i)) {
        hours = Math.min(Math.max(parseInt(args[0]), 1), 72);
    }

    const endTime = Date.now() + hours * 3600000;
    pollVotes.set(guildId, {});

    // Set activePolls trước để createPollEmbed đọc được
    activePolls.set(guildId, {
        messageId: null,
        channelId: message.channel.id,
        creatorId: message.author.id,
        creatorName: message.author.username,
        endTime,
        timeout: null,
    });

    // Gửi message
    const pollMsg = await message.channel.send({
        embeds: [createPollEmbed(guildId)],
        components: createMainButtons()
    });

    // Cập nhật messageId và timeout
    const poll = activePolls.get(guildId);
    poll.messageId = pollMsg.id;
    poll.timeout = setTimeout(() => endPoll(message.client, guildId, message.channel), hours * 3600000);

    try { await message.delete(); } catch (e) { }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    name: 'voteevent',
    aliases: ['votesukien', 'votelich'],
    description: 'Bình chọn lịch sự kiện Guild',
    execute,
    handleVote,
    handleButton,
    activePolls,
    EVENTS
};
