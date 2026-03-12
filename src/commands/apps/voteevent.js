/**
 * ?voteevent command - Bình chọn lịch sự kiện Guild
 * Cho phép thành viên vote giờ cho: Yến Tiệc, Boss Solo, PvP Solo
 * Boss Solo và PvP Solo có thêm vote ngày (2 ngày mỗi loại)
 * 
 * Usage:
 * - ?voteevent - Tạo bình chọn mới (24h)
 * - ?voteevent <hours>h - Tạo bình chọn với thời gian tùy chỉnh
 * - ?voteevent end - Kết thúc sớm và xem kết quả
 * - ?voteevent result - Xem kết quả hiện tại
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Các khung giờ có thể chọn (18h - 23h, mỗi 30 phút)
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

// Các ngày trong tuần
const DAY_OPTIONS = [
    { label: 'Thứ 2', value: 'thu2', emoji: '📅' },
    { label: 'Thứ 3', value: 'thu3', emoji: '📅' },
    { label: 'Thứ 4', value: 'thu4', emoji: '📅' },
    { label: 'Thứ 5', value: 'thu5', emoji: '📅' },
    { label: 'Thứ 6', value: 'thu6', emoji: '📅' },
    { label: 'Thứ 7', value: 'thu7', emoji: '📅' },
    { label: 'Chủ nhật', value: 'cn', emoji: '🌟' },
];

// Các sự kiện cần vote
const EVENTS = [
    { id: 'yentiec', name: 'Yến Tiệc', emoji: '🍽️', hasDay: false },
    { id: 'bosssolo', name: 'Boss Solo', emoji: '⚔️', hasDay: true },
    { id: 'pvpsolo', name: 'PvP Solo', emoji: '🏆', hasDay: true },
];

// Lưu trữ poll (guildId -> pollData)
const activePolls = new Map();

// Lưu trữ votes
const pollVotes = new Map();

/**
 * Tạo progress bar
 */
function createProgressBar(percentage, length = 10) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Lấy tên ngày từ value
 */
function getDayName(value) {
    const day = DAY_OPTIONS.find(d => d.value === value);
    return day ? day.label : value;
}

/**
 * Tính kết quả vote
 */
function calculateResults(guildId, voteKey) {
    const guildVotes = pollVotes.get(guildId);
    if (!guildVotes || !guildVotes[voteKey]) return { results: [], total: 0 };

    const voteCounts = {};
    for (const [userId, value] of Object.entries(guildVotes[voteKey])) {
        voteCounts[value] = (voteCounts[value] || 0) + 1;
    }

    const total = Object.values(voteCounts).reduce((a, b) => a + b, 0);
    const results = Object.entries(voteCounts)
        .map(([value, count]) => ({
            value,
            count,
            percentage: total > 0 ? Math.round((count / total) * 100) : 0
        }))
        .sort((a, b) => b.count - a.count);

    return { results, total };
}

/**
 * Tạo embed kết quả
 */
function createResultEmbed(guildId) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 KẾT QUẢ BÌNH CHỌN LỊCH SỰ KIỆN')
        .setTimestamp();

    let totalVoters = new Set();
    const resultLines = [];

    for (const event of EVENTS) {
        const timeKey = `${event.id}_time`;
        const { results: timeResults } = calculateResults(guildId, timeKey);

        if (event.hasDay) {
            const daysKey = `${event.id}_days`;
            const { results: daysResults } = calculateResults(guildId, daysKey);

            resultLines.push(`\n${event.emoji} **${event.name}**`);

            if (timeResults.length > 0) {
                resultLines.push(`   ⏰ Giờ: **${timeResults[0].value}**`);
            } else {
                resultLines.push(`   ⏰ Giờ: Chưa có vote`);
            }

            if (daysResults.length >= 2) {
                resultLines.push(`   📅 Ngày: **${getDayName(daysResults[0].value)}** và **${getDayName(daysResults[1].value)}**`);
            } else if (daysResults.length === 1) {
                resultLines.push(`   📅 Ngày: **${getDayName(daysResults[0].value)}** (cần thêm vote)`);
            } else {
                resultLines.push(`   📅 Ngày: Chưa có vote`);
            }
        } else {
            if (timeResults.length === 0) {
                resultLines.push(`\n${event.emoji} **${event.name}** - Chưa có vote`);
            } else {
                resultLines.push(`\n${event.emoji} **${event.name}** - **${timeResults[0].value}** (Mỗi ngày)`);
                for (const r of timeResults.slice(0, 3)) {
                    resultLines.push(`   ${r.value} ${createProgressBar(r.percentage)} ${r.count} (${r.percentage}%)`);
                }
            }
        }

        const guildVotes = pollVotes.get(guildId);
        if (guildVotes) {
            [timeKey, `${event.id}_days`].forEach(key => {
                if (guildVotes[key]) {
                    Object.keys(guildVotes[key]).forEach(id => totalVoters.add(id));
                }
            });
        }
    }

    embed.setDescription(resultLines.join('\n'));
    embed.setFooter({ text: `👥 Tổng: ${totalVoters.size} người tham gia` });
    return embed;
}

/**
 * Tạo embed poll chính
 */
function createPollEmbed(guildId, endTime, creatorName) {
    const guildVotes = pollVotes.get(guildId) || {};
    let totalVoters = new Set();

    for (const key of Object.keys(guildVotes)) {
        Object.keys(guildVotes[key]).forEach(id => totalVoters.add(id));
    }

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📊 BÌNH CHỌN LỊCH SỰ KIỆN GUILD')
        .setDescription([
            '**Hướng dẫn:**',
            '• Chọn **giờ** cho mỗi sự kiện từ dropdown',
            '• Boss Solo & PvP Solo: chọn thêm **2 ngày** trong tuần',
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
            `🍽️ **Yến Tiệc** - Mỗi ngày`,
            `⚔️ **Boss Solo** - 2 ngày/tuần`,
            `🏆 **PvP Solo** - 2 ngày/tuần`,
            '━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n'))
        .addFields(
            { name: '⏰ Kết thúc', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
            { name: '👥 Đã vote', value: `${totalVoters.size} người`, inline: true }
        )
        .setFooter({ text: `Tạo bởi ${creatorName} • Dùng các dropdown bên dưới để vote` })
        .setTimestamp();

    return embed;
}

/**
 * Tạo dropdown menus - Thiết kế mới gọn hơn
 * Row 1: Yến Tiệc (giờ)
 * Row 2: Boss Solo (giờ) 
 * Row 3: Boss Solo (2 ngày)
 * Row 4: PvP Solo (giờ + 2 ngày kết hợp)
 * Row 5: Buttons
 */
function createSelectMenus() {
    const rows = [];

    // Row 1: Yến Tiệc - Giờ
    const yentiecMenu = new StringSelectMenuBuilder()
        .setCustomId('voteevent_yentiec_time')
        .setPlaceholder('🍽️ Yến Tiệc - Chọn giờ (mỗi ngày)')
        .addOptions(TIME_OPTIONS.map(t => ({
            label: `Yến Tiệc ${t.label}`,
            value: t.value,
            emoji: t.emoji
        })));
    rows.push(new ActionRowBuilder().addComponents(yentiecMenu));

    // Row 2: Boss Solo - Giờ
    const bossTimeMenu = new StringSelectMenuBuilder()
        .setCustomId('voteevent_bosssolo_time')
        .setPlaceholder('⚔️ Boss Solo - Chọn giờ')
        .addOptions(TIME_OPTIONS.map(t => ({
            label: `Boss Solo ${t.label}`,
            value: t.value,
            emoji: t.emoji
        })));
    rows.push(new ActionRowBuilder().addComponents(bossTimeMenu));

    // Row 3: Boss Solo - 2 Ngày
    const bossDayMenu = new StringSelectMenuBuilder()
        .setCustomId('voteevent_bosssolo_days')
        .setPlaceholder('📅 Boss Solo - Chọn 2 ngày')
        .setMinValues(2)
        .setMaxValues(2)
        .addOptions(DAY_OPTIONS.map(d => ({
            label: `Boss ${d.label}`,
            value: d.value,
            emoji: d.emoji
        })));
    rows.push(new ActionRowBuilder().addComponents(bossDayMenu));

    // Row 4: PvP Solo - Giờ + Ngày kết hợp (dùng button để mở)
    const pvpCombinedMenu = new StringSelectMenuBuilder()
        .setCustomId('voteevent_pvpsolo_time')
        .setPlaceholder('🏆 PvP Solo - Chọn giờ')
        .addOptions(TIME_OPTIONS.map(t => ({
            label: `PvP Solo ${t.label}`,
            value: t.value,
            emoji: t.emoji
        })));
    rows.push(new ActionRowBuilder().addComponents(pvpCombinedMenu));

    // Row 5: Buttons
    const buttonRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('voteevent_pvpdays_btn')
                .setLabel('📅 Chọn ngày PvP')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('voteevent_result')
                .setLabel('📊 Kết quả')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('voteevent_end')
                .setLabel('🛑 Kết thúc')
                .setStyle(ButtonStyle.Danger)
        );
    rows.push(buttonRow);

    return rows;
}

/**
 * Xử lý vote từ select menu
 */
async function handleVote(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const customId = interaction.customId;

    if (!activePolls.has(guildId)) {
        return interaction.reply({ content: '❌ Không có bình chọn nào đang diễn ra!', ephemeral: true });
    }

    // Parse: voteevent_eventId_type
    const parts = customId.replace('voteevent_', '').split('_');
    const eventId = parts[0];
    const voteType = parts[1];

    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    const guildVotes = pollVotes.get(guildId);

    const event = EVENTS.find(e => e.id === eventId);
    if (!event) return interaction.reply({ content: '❌ Sự kiện không hợp lệ!', ephemeral: true });

    if (voteType === 'time') {
        const voteKey = `${eventId}_time`;
        if (!guildVotes[voteKey]) guildVotes[voteKey] = {};
        guildVotes[voteKey][userId] = interaction.values[0];
    } else if (voteType === 'days') {
        const voteKey = `${eventId}_days`;
        if (!guildVotes[voteKey]) guildVotes[voteKey] = {};
        const selectedDays = interaction.values.sort();
        guildVotes[voteKey][userId] = selectedDays.join(',');
    }

    // Không gửi reply - chỉ cập nhật embed và acknowledge
    await interaction.deferUpdate();

    // Update embed với số người vote mới
    try {
        const poll = activePolls.get(guildId);
        if (poll?.messageId) {
            const channel = await interaction.client.channels.fetch(poll.channelId);
            const message = await channel.messages.fetch(poll.messageId);
            await message.edit({ embeds: [createPollEmbed(guildId, poll.endTime, poll.creatorName)] });
        }
    } catch (e) { }
}

/**
 * Xử lý button click
 */
async function handleButton(interaction) {
    const guildId = interaction.guild.id;
    const customId = interaction.customId;

    if (customId === 'voteevent_pvpdays_btn') {
        if (!activePolls.has(guildId)) {
            return interaction.reply({ content: '❌ Không có bình chọn nào đang diễn ra!', ephemeral: true });
        }

        const pvpDayMenu = new StringSelectMenuBuilder()
            .setCustomId('voteevent_pvpsolo_days')
            .setPlaceholder('📅 Chọn 2 ngày PvP Solo')
            .setMinValues(2)
            .setMaxValues(2)
            .addOptions(DAY_OPTIONS.map(d => ({
                label: `PvP ${d.label}`,
                value: d.value,
                emoji: d.emoji
            })));

        return interaction.reply({
            content: '🏆 **Chọn 2 ngày cho PvP Solo:**',
            components: [new ActionRowBuilder().addComponents(pvpDayMenu)],
            ephemeral: true
        });
    }

    if (customId === 'voteevent_result') {
        if (!pollVotes.has(guildId) && !activePolls.has(guildId)) {
            return interaction.reply({ content: '❌ Không có dữ liệu!', ephemeral: true });
        }
        return interaction.reply({ embeds: [createResultEmbed(guildId)], ephemeral: true });
    }

    if (customId === 'voteevent_end') {
        const poll = activePolls.get(guildId);
        const hasPermission = interaction.member.roles.cache.some(r => r.name === 'Quản Lý') ||
            (poll?.creatorId === interaction.user.id);

        if (!hasPermission) {
            return interaction.reply({ content: '❌ Bạn không có quyền!', ephemeral: true });
        }

        await endPoll(interaction.client, guildId, interaction.channel);
        return interaction.reply({ content: '✅ Đã kết thúc!', ephemeral: true });
    }
}

/**
 * Kết thúc poll
 */
async function endPoll(client, guildId, channel) {
    const poll = activePolls.get(guildId);
    if (!poll) return;

    if (poll.timeout) clearTimeout(poll.timeout);

    try {
        const ch = await client.channels.fetch(poll.channelId);
        const msg = await ch.messages.fetch(poll.messageId);
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('📊 BÌNH CHỌN ĐÃ KẾT THÚC').setTimestamp()],
            components: []
        });
    } catch (e) { }

    await channel.send({ embeds: [createResultEmbed(guildId)] });
    activePolls.delete(guildId);
}

/**
 * Execute command
 */
async function execute(message, args) {
    const guildId = message.guild.id;

    if (!message.member.roles.cache.some(r => r.name === 'Quản Lý' || r.name === 'Kỳ Cựu')) {
        return message.reply('❌ Bạn cần role **Quản Lý** hoặc **Kỳ Cựu**!');
    }

    if (args[0] === 'end') {
        if (!activePolls.has(guildId)) return message.reply('❌ Không có bình chọn!');
        await endPoll(message.client, guildId, message.channel);
        return;
    }

    if (args[0] === 'result') {
        if (!pollVotes.has(guildId)) return message.reply('❌ Không có dữ liệu!');
        return message.reply({ embeds: [createResultEmbed(guildId)] });
    }

    if (activePolls.has(guildId)) {
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?voteevent end` để kết thúc.');
    }

    let hours = 24;
    if (args[0]?.match(/^(\d+)h$/i)) {
        hours = Math.min(Math.max(parseInt(args[0]), 1), 72);
    }

    const endTime = Date.now() + hours * 3600000;
    pollVotes.set(guildId, {});

    const pollMsg = await message.channel.send({
        embeds: [createPollEmbed(guildId, endTime, message.author.username)],
        components: createSelectMenus()
    });

    activePolls.set(guildId, {
        messageId: pollMsg.id,
        channelId: message.channel.id,
        creatorId: message.author.id,
        creatorName: message.author.username,
        endTime,
        timeout: setTimeout(() => endPoll(message.client, guildId, message.channel), hours * 3600000)
    });

    try { await message.delete(); } catch (e) { }
}

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
