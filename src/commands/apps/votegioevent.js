/**
 * ?votegioevent - Bình chọn GIỜ sự kiện Guild
 * Vote giờ cho: Yến Tiệc, Boss Solo, PvP Solo
 * 
 * Usage:
 * - ?votegioevent - Tạo bình chọn giờ (24h)
 * - ?votegioevent <hours>h - Tạo bình chọn với thời gian tùy chỉnh
 * - ?votegioevent end - Kết thúc sớm
 * - ?votegioevent result - Xem kết quả
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Các khung giờ (18h - 23h, mỗi 30 phút)
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

const EVENTS = [
    { id: 'yentiec', name: 'Yến Tiệc', emoji: '🍽️', defaultTime: '21:00' },
    { id: 'bosssolo', name: 'Boss Solo', emoji: '⚔️', defaultTime: '20:00' },
    { id: 'pvpsolo', name: 'PvP Solo', emoji: '🏆', defaultTime: '20:00' },
];

const activePolls = new Map();
const pollVotes = new Map();

const UPDATE_INTERVAL = 15 * 60 * 1000; // 15 phút

function createProgressBar(pct, len = 8) {
    const f = Math.round((pct / 100) * len);
    return '█'.repeat(f) + '░'.repeat(len - f);
}

function calculateResults(guildId, eventId) {
    const gv = pollVotes.get(guildId);
    if (!gv || !gv[eventId]) return { results: [], total: 0 };
    const counts = {};
    for (const v of Object.values(gv[eventId])) counts[v] = (counts[v] || 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const results = Object.entries(counts)
        .map(([value, count]) => ({ value, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
    return { results, total };
}

function createResultEmbed(guildId) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 KẾT QUẢ BÌNH CHỌN GIỜ SỰ KIỆN')
        .setTimestamp();

    const lines = [];
    let voters = new Set();

    for (const e of EVENTS) {
        const { results } = calculateResults(guildId, e.id);
        if (results.length === 0) {
            lines.push(`${e.emoji} **${e.name}** - Chưa có vote`);
        } else {
            lines.push(`${e.emoji} **${e.name}** - **${results[0].value}**`);
            for (const r of results.slice(0, 3)) {
                lines.push(`   ${r.value} ${createProgressBar(r.pct)} ${r.count} (${r.pct}%)`);
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
        const { results } = calculateResults(guildId, e.id);
        if (results.length === 0) {
            resultLines.push(`${e.emoji} **${e.name}**: _chưa có vote_`);
        } else {
            const top = results[0];
            const others = results.slice(1, 3).map(r => `${r.value}(${r.count})`).join(', ');
            resultLines.push(`${e.emoji} **${e.name}**: **${top.value}** (${top.count} votes)${others ? ` • ${others}` : ''}`);
        }
    }

    return new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('⏰ BÌNH CHỌN GIỜ SỰ KIỆN')
        .setDescription([
            '**Kết quả hiện tại:**',
            ...resultLines,
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
            '_Chọn giờ từ dropdown bên dưới_'
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
        const sortedOptions = [...TIME_OPTIONS].sort((a, b) => {
            if (a.value === e.defaultTime) return -1;
            if (b.value === e.defaultTime) return 1;
            return 0;
        });

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`votegio_${e.id}`)
            .setPlaceholder(`${e.emoji} ${e.name} - Giờ hiện tại: ${e.defaultTime}`)
            .addOptions(sortedOptions.map(t => ({
                label: t.value === e.defaultTime ? `⭐ ${e.name} ${t.label} (hiện tại)` : `${e.name} ${t.label}`,
                value: t.value,
                emoji: t.emoji,
                description: t.value === e.defaultTime ? 'Giữ nguyên giờ hiện tại' : undefined
            })));
        rows.push(new ActionRowBuilder().addComponents(menu));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('votegio_result').setLabel('📊 Chi tiết').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('votegio_end').setLabel('🛑 Kết thúc').setStyle(ButtonStyle.Danger)
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
    const eventId = interaction.customId.replace('votegio_', '');

    if (!activePolls.has(guildId)) {
        return interaction.reply({ content: '❌ Không có bình chọn!', ephemeral: true });
    }

    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    const gv = pollVotes.get(guildId);
    if (!gv[eventId]) gv[eventId] = {};
    gv[eventId][userId] = interaction.values[0];

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
    const action = interaction.customId.replace('votegio_', '');

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
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('⏰ BÌNH CHỌN GIỜ ĐÃ KẾT THÚC').setTimestamp()],
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
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?votegioevent end` để kết thúc.');
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
    name: 'votegioevent',
    aliases: ['votegio'],
    description: 'Bình chọn GIỜ sự kiện Guild',
    execute,
    handleVote,
    handleButton,
    activePolls,
    EVENTS
};
