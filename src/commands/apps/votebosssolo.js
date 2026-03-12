/**
 * ?votebosssolo - Bình chọn lịch Boss Solo
 * Vote ngày + giờ cho 2 ngày Boss Solo trong tuần
 * 
 * Usage:
 * - ?votebosssolo - Tạo bình chọn (24h)
 * - ?votebosssolo end - Kết thúc sớm
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

const DAY_OPTIONS = [
    { label: 'Thứ 2', value: 'thu2', emoji: '📅' },
    { label: 'Thứ 3', value: 'thu3', emoji: '📅' },
    { label: 'Thứ 4', value: 'thu4', emoji: '📅' },
    { label: 'Thứ 5', value: 'thu5', emoji: '📅' },
    { label: 'Thứ 6', value: 'thu6', emoji: '📅' },
    { label: 'Thứ 7', value: 'thu7', emoji: '📅' },
    { label: 'Chủ nhật', value: 'cn', emoji: '🌟' },
];

// Giá trị hiện tại
const DEFAULTS = {
    day1: 'thu4',
    time1: '20:00',
    day2: 'cn',
    time2: '18:00'
};

const UPDATE_INTERVAL = 15 * 60 * 1000;
const activePolls = new Map();
const pollVotes = new Map(); // guildId -> { day1: {}, time1: {}, day2: {}, time2: {} }

function getDayName(v) {
    return DAY_OPTIONS.find(d => d.value === v)?.label || v;
}

// Thứ tự ngày trong tuần (dùng để so sánh)
const DAY_ORDER = ['thu2', 'thu3', 'thu4', 'thu5', 'thu6', 'thu7', 'cn'];

function getDayIndex(v) {
    return DAY_ORDER.indexOf(v);
}

// Đảm bảo day1 < day2 (tự động swap nếu cần)
function getOrderedDays(guildId) {
    const { results: day1Results } = calculateResults(guildId, 'day1');
    const { results: day2Results } = calculateResults(guildId, 'day2');

    let day1Val = day1Results.length > 0 ? day1Results[0].value : DEFAULTS.day1;
    let day2Val = day2Results.length > 0 ? day2Results[0].value : DEFAULTS.day2;

    const time1 = getTopResultRaw(guildId, 'time1', DEFAULTS.time1);
    const time2 = getTopResultRaw(guildId, 'time2', DEFAULTS.time2);

    // Nếu day1 > day2 trong tuần, swap lại
    if (getDayIndex(day1Val) > getDayIndex(day2Val)) {
        return {
            day1: getDayName(day2Val),
            time1: time2,
            day2: getDayName(day1Val),
            time2: time1
        };
    }

    return {
        day1: getDayName(day1Val),
        time1,
        day2: getDayName(day2Val),
        time2
    };
}

function calculateResults(guildId, key) {
    const gv = pollVotes.get(guildId);
    if (!gv || !gv[key]) return { results: [], total: 0 };
    const counts = {};
    for (const v of Object.values(gv[key])) counts[v] = (counts[v] || 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
        results: Object.entries(counts)
            .map(([value, count]) => ({ value, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
            .sort((a, b) => b.count - a.count),
        total
    };
}

function getTopResult(guildId, key, defaultVal, isDayValue = false) {
    const { results } = calculateResults(guildId, key);
    if (results.length === 0) return defaultVal;
    return isDayValue ? getDayName(results[0].value) : results[0].value;
}

function getTopResultRaw(guildId, key, defaultVal) {
    const { results } = calculateResults(guildId, key);
    if (results.length === 0) return defaultVal;
    return results[0].value;
}

function countVoters(guildId) {
    const gv = pollVotes.get(guildId);
    if (!gv) return 0;
    const voters = new Set();
    for (const key of Object.keys(gv)) {
        Object.keys(gv[key]).forEach(id => voters.add(id));
    }
    return voters.size;
}

function createResultEmbed(guildId) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('⚔️ KẾT QUẢ BÌNH CHỌN BOSS SOLO')
        .setTimestamp();

    // Sử dụng getOrderedDays để đảm bảo day1 < day2
    const ordered = getOrderedDays(guildId);

    embed.setDescription([
        `**📅 Ngày 1:** ${ordered.day1} lúc **${ordered.time1}**`,
        `**📅 Ngày 2:** ${ordered.day2} lúc **${ordered.time2}**`,
    ].join('\n'));

    embed.setFooter({ text: `👥 ${countVoters(guildId)} người tham gia` });
    return embed;
}

function createPollEmbed(guildId, endTime, creator) {
    // Sử dụng getOrderedDays để đảm bảo day1 < day2
    const ordered = getOrderedDays(guildId);

    return new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('⚔️ BÌNH CHỌN LỊCH BOSS SOLO')
        .setDescription([
            `**Lịch hiện tại:** ${getDayName(DEFAULTS.day1)} ${DEFAULTS.time1} | ${getDayName(DEFAULTS.day2)} ${DEFAULTS.time2}`,
            '',
            '**Kết quả hiện tại:**',
            `📅 **Ngày 1:** ${ordered.day1} lúc **${ordered.time1}**`,
            `📅 **Ngày 2:** ${ordered.day2} lúc **${ordered.time2}**`,
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
            '_Chọn ngày và giờ từ dropdown bên dưới_'
        ].join('\n'))
        .addFields(
            { name: '⏰ Kết thúc', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
            { name: '👥 Đã vote', value: `${countVoters(guildId)} người`, inline: true }
        )
        .setFooter({ text: `Tạo bởi ${creator} • Tự động cập nhật mỗi 15 phút` })
        .setTimestamp();
}

function sortOptions(options, defaultVal) {
    return [...options].sort((a, b) => {
        if (a.value === defaultVal) return -1;
        if (b.value === defaultVal) return 1;
        return 0;
    });
}

function createMenus() {
    const rows = [];

    // Ngày 1
    const day1Options = sortOptions(DAY_OPTIONS, DEFAULTS.day1);
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('voteboss_day1')
            .setPlaceholder(`📅 Ngày 1 - Hiện tại: ${getDayName(DEFAULTS.day1)}`)
            .addOptions(day1Options.map(d => ({
                label: d.value === DEFAULTS.day1 ? `⭐ ${d.label} (hiện tại)` : d.label,
                value: d.value,
                emoji: d.emoji
            })))
    ));

    // Giờ ngày 1
    const time1Options = sortOptions(TIME_OPTIONS, DEFAULTS.time1);
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('voteboss_time1')
            .setPlaceholder(`⏰ Giờ ngày 1 - Hiện tại: ${DEFAULTS.time1}`)
            .addOptions(time1Options.map(t => ({
                label: t.value === DEFAULTS.time1 ? `⭐ ${t.label} (hiện tại)` : t.label,
                value: t.value,
                emoji: t.emoji
            })))
    ));

    // Ngày 2
    const day2Options = sortOptions(DAY_OPTIONS, DEFAULTS.day2);
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('voteboss_day2')
            .setPlaceholder(`📅 Ngày 2 - Hiện tại: ${getDayName(DEFAULTS.day2)}`)
            .addOptions(day2Options.map(d => ({
                label: d.value === DEFAULTS.day2 ? `⭐ ${d.label} (hiện tại)` : d.label,
                value: d.value,
                emoji: d.emoji
            })))
    ));

    // Giờ ngày 2
    const time2Options = sortOptions(TIME_OPTIONS, DEFAULTS.time2);
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('voteboss_time2')
            .setPlaceholder(`⏰ Giờ ngày 2 - Hiện tại: ${DEFAULTS.time2}`)
            .addOptions(time2Options.map(t => ({
                label: t.value === DEFAULTS.time2 ? `⭐ ${t.label} (hiện tại)` : t.label,
                value: t.value,
                emoji: t.emoji
            })))
    ));

    // Buttons
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('voteboss_result').setLabel('📊 Chi tiết').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('voteboss_end').setLabel('🛑 Kết thúc').setStyle(ButtonStyle.Danger)
    ));

    return rows;
}

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
    if (!activePolls.has(guildId)) {
        return interaction.reply({ content: '❌ Không có bình chọn!', ephemeral: true });
    }

    const key = interaction.customId.replace('voteboss_', '');
    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    const gv = pollVotes.get(guildId);
    if (!gv[key]) gv[key] = {};
    gv[key][interaction.user.id] = interaction.values[0];

    await interaction.deferUpdate();
    await updatePollEmbed(interaction.client, guildId);
}

async function handleButton(interaction) {
    const guildId = interaction.guild.id;
    const action = interaction.customId.replace('voteboss_', '');

    if (action === 'result') {
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
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('⚔️ BÌNH CHỌN BOSS SOLO ĐÃ KẾT THÚC').setTimestamp()],
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

    if (activePolls.has(guildId)) {
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?votebosssolo end` để kết thúc.');
    }

    let hours = 24;
    if (args[0]?.match(/^(\d+)h$/i)) hours = Math.min(Math.max(parseInt(args[0]), 1), 72);

    const endTime = Date.now() + hours * 3600000;
    pollVotes.set(guildId, {});

    const pollMsg = await message.channel.send({
        embeds: [createPollEmbed(guildId, endTime, message.author.username)],
        components: createMenus()
    });

    activePolls.set(guildId, {
        messageId: pollMsg.id,
        channelId: message.channel.id,
        creatorId: message.author.id,
        creatorName: message.author.username,
        endTime,
        timeout: setTimeout(() => endPoll(message.client, guildId, message.channel), hours * 3600000),
        updateInterval: setInterval(() => updatePollEmbed(message.client, guildId), UPDATE_INTERVAL)
    });

    try { await message.delete(); } catch (e) { }
}

module.exports = {
    name: 'votebosssolo',
    aliases: ['voteboss'],
    description: 'Bình chọn lịch Boss Solo',
    execute,
    handleVote,
    handleButton,
    activePolls
};
