/**
 * ?votengayevent - Bình chọn NGÀY sự kiện Guild
 * Vote ngày cho: Boss Solo, PvP Solo (mỗi loại 2 ngày)
 * 
 * Usage:
 * - ?votengayevent - Tạo bình chọn ngày (24h)
 * - ?votengayevent <hours>h - Tạo bình chọn với thời gian tùy chỉnh
 * - ?votengayevent end - Kết thúc sớm
 * - ?votengayevent result - Xem kết quả
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DAY_OPTIONS = [
    { label: 'Thứ 2', value: 'thu2', emoji: '📅' },
    { label: 'Thứ 3', value: 'thu3', emoji: '📅' },
    { label: 'Thứ 4', value: 'thu4', emoji: '📅' },
    { label: 'Thứ 5', value: 'thu5', emoji: '📅' },
    { label: 'Thứ 6', value: 'thu6', emoji: '📅' },
    { label: 'Thứ 7', value: 'thu7', emoji: '📅' },
    { label: 'Chủ nhật', value: 'cn', emoji: '🌟' },
];

const EVENTS = [
    { id: 'bosssolo', name: 'Boss Solo', emoji: '⚔️', defaultDays: ['thu4', 'cn'] },
    { id: 'pvpsolo', name: 'PvP Solo', emoji: '🏆', defaultDays: ['thu6', 'cn'] },
];

const activePolls = new Map();
const pollVotes = new Map();

const UPDATE_INTERVAL = 15 * 60 * 1000; // 15 phút

function getDayName(v) {
    const d = DAY_OPTIONS.find(x => x.value === v);
    return d ? d.label : v;
}

function calculateResults(guildId, eventId) {
    const gv = pollVotes.get(guildId);
    if (!gv || !gv[eventId]) return { results: [], total: 0 };

    // Đếm từng ngày riêng (mỗi user chọn 2 ngày)
    const counts = {};
    for (const days of Object.values(gv[eventId])) {
        const arr = days.split(',');
        for (const d of arr) {
            counts[d] = (counts[d] || 0) + 1;
        }
    }

    const total = Object.keys(gv[eventId]).length;
    const results = Object.entries(counts)
        .map(([value, count]) => ({ value, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
    return { results, total };
}

function createResultEmbed(guildId) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 KẾT QUẢ BÌNH CHỌN NGÀY SỰ KIỆN')
        .setTimestamp();

    const lines = [];
    let voters = new Set();

    for (const e of EVENTS) {
        const { results, total } = calculateResults(guildId, e.id);
        if (results.length === 0) {
            lines.push(`\n${e.emoji} **${e.name}** - Chưa có vote`);
        } else {
            const top2 = results.slice(0, 2);
            lines.push(`\n${e.emoji} **${e.name}**`);
            lines.push(`   📅 **${top2.map(r => getDayName(r.value)).join(' và ')}**`);
            for (const r of results) {
                lines.push(`   ${getDayName(r.value)}: ${r.count} votes (${r.pct}%)`);
            }
        }

        const gv = pollVotes.get(guildId);
        if (gv?.[e.id]) Object.keys(gv[e.id]).forEach(id => voters.add(id));
    }

    embed.setDescription(lines.join('\n'));
    embed.setFooter({ text: `👥 ${voters.size} người tham gia` });
    return embed;
}

function createPollEmbed(guildId, endTime, creator) {
    const gv = pollVotes.get(guildId) || {};
    let voters = new Set();
    for (const k of Object.keys(gv)) Object.keys(gv[k]).forEach(id => voters.add(id));

    // Tạo phần kết quả hiện tại
    const resultLines = [];
    for (const e of EVENTS) {
        const { results, total } = calculateResults(guildId, e.id);
        if (results.length === 0) {
            resultLines.push(`${e.emoji} **${e.name}**: _chưa có vote_`);
        } else {
            const top2 = results.slice(0, 2).map(r => `**${getDayName(r.value)}**(${r.count})`).join(' + ');
            resultLines.push(`${e.emoji} **${e.name}**: ${top2}`);
        }
    }

    return new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('📅 BÌNH CHỌN NGÀY SỰ KIỆN')
        .setDescription([
            '**Kết quả hiện tại:**',
            ...resultLines,
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
            '_Chọn 2 ngày từ dropdown bên dưới_'
        ].join('\n'))
        .addFields(
            { name: '⏰ Kết thúc', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
            { name: '👥 Đã vote', value: `${voters.size} người`, inline: true }
        )
        .setFooter({ text: `Tạo bởi ${creator} • Tự động cập nhật mỗi 15 phút` })
        .setTimestamp();
}

function createMenus() {
    const rows = [];
    for (const e of EVENTS) {
        // Sắp xếp options: default lên đầu
        const sortedOptions = [...DAY_OPTIONS].sort((a, b) => {
            const aIsDefault = e.defaultDays.includes(a.value);
            const bIsDefault = e.defaultDays.includes(b.value);
            if (aIsDefault && !bIsDefault) return -1;
            if (!aIsDefault && bIsDefault) return 1;
            return 0;
        });

        const defaultDayNames = e.defaultDays.map(getDayName).join(' + ');
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`votengay_${e.id}`)
            .setPlaceholder(`${e.emoji} ${e.name} - Hiện tại: ${defaultDayNames}`)
            .setMinValues(2)
            .setMaxValues(2)
            .addOptions(sortedOptions.map(d => ({
                label: e.defaultDays.includes(d.value)
                    ? `⭐ ${e.name} - ${d.label} (hiện tại)`
                    : `${e.name} - ${d.label}`,
                value: d.value,
                emoji: d.emoji,
                description: e.defaultDays.includes(d.value) ? 'Ngày hiện tại' : undefined
            })));
        rows.push(new ActionRowBuilder().addComponents(menu));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('votengay_result').setLabel('📊 Chi tiết').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('votengay_end').setLabel('🛑 Kết thúc').setStyle(ButtonStyle.Danger)
    ));
    return rows;
}

// Hàm cập nhật embed tự động
async function updatePollEmbed(client, guildId) {
    const poll = activePolls.get(guildId);
    if (!poll) return;

    try {
        const ch = await client.channels.fetch(poll.channelId);
        const msg = await ch.messages.fetch(poll.messageId);
        await msg.edit({ embeds: [createPollEmbed(guildId, poll.endTime, poll.creatorName)] });
    } catch (e) { }
}

async function handleVote(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const eventId = interaction.customId.replace('votengay_', '');

    if (!activePolls.has(guildId)) {
        return interaction.reply({ content: '❌ Không có bình chọn!', ephemeral: true });
    }

    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    const gv = pollVotes.get(guildId);
    if (!gv[eventId]) gv[eventId] = {};

    const selectedDays = interaction.values.sort();
    gv[eventId][userId] = selectedDays.join(',');

    await interaction.deferUpdate();

    // Cập nhật embed ngay lập tức
    try {
        const poll = activePolls.get(guildId);
        if (poll?.messageId) {
            const ch = await interaction.client.channels.fetch(poll.channelId);
            const msg = await ch.messages.fetch(poll.messageId);
            await msg.edit({ embeds: [createPollEmbed(guildId, poll.endTime, poll.creatorName)] });
        }
    } catch (e) { }
}

async function handleButton(interaction) {
    const guildId = interaction.guild.id;
    const action = interaction.customId.replace('votengay_', '');

    if (action === 'result') {
        if (!pollVotes.has(guildId)) return interaction.reply({ content: '❌ Không có dữ liệu!', ephemeral: true });
        return interaction.reply({ embeds: [createResultEmbed(guildId)], ephemeral: true });
    }

    if (action === 'end') {
        const poll = activePolls.get(guildId);
        const ok = interaction.member.roles.cache.some(r => r.name === 'Quản Lý') || poll?.creatorId === interaction.user.id;
        if (!ok) return interaction.reply({ content: '❌ Không có quyền!', ephemeral: true });
        await endPoll(interaction.client, guildId, interaction.channel);
        return interaction.reply({ content: '✅ Đã kết thúc!', ephemeral: true });
    }
}

async function endPoll(client, guildId, channel) {
    const poll = activePolls.get(guildId);
    if (!poll) return;

    if (poll.timeout) clearTimeout(poll.timeout);
    if (poll.updateInterval) clearInterval(poll.updateInterval);

    try {
        const ch = await client.channels.fetch(poll.channelId);
        const msg = await ch.messages.fetch(poll.messageId);
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('📅 BÌNH CHỌN NGÀY ĐÃ KẾT THÚC').setTimestamp()],
            components: []
        });
    } catch (e) { }

    await channel.send({ embeds: [createResultEmbed(guildId)] });
    activePolls.delete(guildId);
}

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
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?votengayevent end` để kết thúc.');
    }

    let hours = 24;
    if (args[0]?.match(/^(\d+)h$/i)) hours = Math.min(Math.max(parseInt(args[0]), 1), 72);

    const endTime = Date.now() + hours * 3600000;
    pollVotes.set(guildId, {});

    const pollMsg = await message.channel.send({
        embeds: [createPollEmbed(guildId, endTime, message.author.username)],
        components: createMenus()
    });

    // Tạo interval cập nhật embed mỗi 15 phút
    const updateInterval = setInterval(() => {
        updatePollEmbed(message.client, guildId);
    }, UPDATE_INTERVAL);

    activePolls.set(guildId, {
        messageId: pollMsg.id,
        channelId: message.channel.id,
        creatorId: message.author.id,
        creatorName: message.author.username,
        endTime,
        timeout: setTimeout(() => endPoll(message.client, guildId, message.channel), hours * 3600000),
        updateInterval
    });

    try { await message.delete(); } catch (e) { }
}

module.exports = {
    name: 'votengayevent',
    aliases: ['votengay'],
    description: 'Bình chọn NGÀY sự kiện Guild',
    execute,
    handleVote,
    handleButton,
    activePolls,
    EVENTS
};
