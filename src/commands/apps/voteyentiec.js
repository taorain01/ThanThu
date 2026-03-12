/**
 * ?voteyentiec - Bình chọn GIỜ Yến Tiệc
 * Vote giờ cho Yến Tiệc (mỗi ngày)
 * 
 * Usage:
 * - ?voteyentiec - Tạo bình chọn (24h)
 * - ?voteyentiec end - Kết thúc sớm
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const TIME_OPTIONS = [
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

const DEFAULT_TIME = '21:00';
const ALLOWED_USER_ID = '395151484179841024';

const activePolls = new Map();
const pollVotes = new Map();

function createProgressBar(pct, len = 8) {
    const f = Math.round((pct / 100) * len);
    return '█'.repeat(f) + '░'.repeat(len - f);
}

function calculateResults(guildId) {
    const gv = pollVotes.get(guildId);
    if (!gv) return { results: [], total: 0 };
    const counts = {};
    for (const v of Object.values(gv)) counts[v] = (counts[v] || 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
        results: Object.entries(counts)
            .map(([value, count]) => ({ value, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
            .sort((a, b) => b.count - a.count),
        total
    };
}

function createResultEmbed(guildId) {
    const { results, total } = calculateResults(guildId);
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🍽️ KẾT QUẢ BÌNH CHỌN YẾN TIỆC')
        .setTimestamp();

    if (results.length === 0) {
        embed.setDescription('Chưa có vote');
    } else {
        const lines = [`**Kết quả: ${results[0].value}** (mỗi ngày)\n`];
        for (const r of results) {
            lines.push(`${r.value} ${createProgressBar(r.pct)} ${r.count} (${r.pct}%)`);
        }
        embed.setDescription(lines.join('\n'));
    }
    embed.setFooter({ text: `👥 ${total} người tham gia` });
    return embed;
}

function createPollEmbed(guildId, endTime, creator) {
    const { total } = calculateResults(guildId);

    return new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('🍽️ BÌNH CHỌN GIỜ YẾN TIỆC')
        .setDescription([
            `**Giờ hiện tại:** ${DEFAULT_TIME} (mỗi ngày)`,
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
        ].join('\n'))
        .addFields(
            { name: '⏰ Kết thúc', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
            { name: '👥 Đã vote', value: `${total} người`, inline: true },
            { name: '\u200b', value: '\u200b' },
            { name: '🗳️ VOTE NGAY', value: '👇 **BẤM VÀO DROPDOWN BÊN DƯỚI ĐỂ VOTE** 👇\n_Chọn giờ bạn muốn và vote sẽ được ghi nhận ngay!_' }
        )
        .setFooter({ text: `Tạo bởi ${creator}` })
        .setTimestamp();
}

function createMenus() {
    const sortedOptions = [...TIME_OPTIONS].sort((a, b) => {
        if (a.value === DEFAULT_TIME) return -1;
        if (b.value === DEFAULT_TIME) return 1;
        return 0;
    });

    const menu = new StringSelectMenuBuilder()
        .setCustomId('voteyentiec_time')
        .setPlaceholder(`🍽️ Yến Tiệc - Giờ hiện tại: ${DEFAULT_TIME}`)
        .addOptions(sortedOptions.map(t => ({
            label: t.value === DEFAULT_TIME ? `⭐ ${t.label} (hiện tại)` : t.label,
            value: t.value,
            emoji: t.emoji,
            description: t.value === DEFAULT_TIME ? 'Giữ nguyên giờ hiện tại' : undefined
        })));

    return [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('voteyentiec_result').setLabel('📊 Chi tiết').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('voteyentiec_end').setLabel('🛑 Kết thúc').setStyle(ButtonStyle.Danger)
        )
    ];
}



async function handleVote(interaction) {
    const guildId = interaction.guild.id;
    if (!activePolls.has(guildId)) {
        return interaction.reply({ content: '❌ Không có bình chọn!', ephemeral: true });
    }

    // Kiểm tra role LangGia
    const langGiaRole = interaction.guild.roles.cache.find(r => r.name === 'LangGia');
    if (!langGiaRole || !interaction.member.roles.cache.has(langGiaRole.id)) {
        return interaction.reply({ content: '❌ Bạn không phải là thành viên của guild.', ephemeral: true });
    }

    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    pollVotes.get(guildId)[interaction.user.id] = interaction.values[0];

    await interaction.reply({ content: `✅ Đã vote **${interaction.values[0]}**!`, ephemeral: true });

    // Cập nhật embed để hiển thị +1 lượt vote
    try {
        const poll = activePolls.get(guildId);
        const channel = await interaction.client.channels.fetch(poll.channelId);
        const pollMsg = await channel.messages.fetch(poll.messageId);
        await pollMsg.edit({
            embeds: [createPollEmbed(guildId, poll.endTime, poll.creatorName)],
            components: createMenus()
        });
    } catch (e) {
        console.error('[voteyentiec] Không thể cập nhật embed:', e);
    }
}

async function handleButton(interaction) {
    const guildId = interaction.guild.id;
    const action = interaction.customId.replace('voteyentiec_', '');

    if (action === 'result') {
        return interaction.reply({ embeds: [createResultEmbed(guildId)], ephemeral: true });
    }

    if (action === 'end') {
        const poll = activePolls.get(guildId);
        if (!poll || poll.creatorId !== interaction.user.id) {
            return interaction.reply({ content: '❌ Chỉ người tạo bình chọn mới có thể kết thúc!', ephemeral: true });
        }
        await endPoll(interaction.client, guildId, interaction.channel, interaction.user);
        return interaction.reply({ content: '✅ Đã kết thúc! Danh sách chi tiết đã gửi qua DM.', ephemeral: true });
    }
}

async function endPoll(client, guildId, channel, creator = null) {
    const poll = activePolls.get(guildId);
    if (!poll) return;
    if (poll.timeout) clearTimeout(poll.timeout);

    // Tạo danh sách chi tiết người vote
    const gv = pollVotes.get(guildId) || {};
    const voterEntries = Object.entries(gv);

    let voterEmbed = null;
    if (voterEntries.length > 0) {
        const grouped = {};
        for (const [userId, time] of voterEntries) {
            if (!grouped[time]) grouped[time] = [];
            grouped[time].push(userId);
        }

        const sortedTimes = Object.keys(grouped).sort((a, b) => {
            const countA = grouped[a].length;
            const countB = grouped[b].length;
            return countB - countA; // Sort by count descending
        });

        let voterList = '';
        for (const time of sortedTimes) {
            const users = grouped[time];
            voterList += `**${time}** (${users.length} người):\n`;
            voterList += users.map(uid => `• <@${uid}>`).join('\n') + '\n\n';
        }

        voterEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('📋 DANH SÁCH CHI TIẾT NGƯỜI ĐÃ VOTE')
            .setDescription(voterList.substring(0, 4000))
            .setFooter({ text: `Tổng: ${voterEntries.length} người` })
            .setTimestamp();
    }

    try {
        const ch = await client.channels.fetch(poll.channelId);
        const msg = await ch.messages.fetch(poll.messageId);
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('🍽️ BÌNH CHỌN YẾN TIỆC ĐÃ KẾT THÚC').setTimestamp()],
            components: []
        });
    } catch (e) { }

    await channel.send({ embeds: [createResultEmbed(guildId)] });

    // Gửi danh sách chi tiết cho người tạo qua DM
    if (creator && voterEmbed) {
        try {
            await creator.send({ embeds: [voterEmbed] });
        } catch (e) {
            console.log('[voteyentiec] Không thể gửi DM cho creator');
        }
    }

    activePolls.delete(guildId);
    pollVotes.delete(guildId);
}

async function execute(message, args) {
    const guildId = message.guild.id;

    // Chỉ cho phép user ID cụ thể dùng lệnh
    if (message.author.id !== ALLOWED_USER_ID) {
        return message.reply('❌ Bạn không có quyền sử dụng lệnh này!');
    }

    if (args[0] === 'end') {
        if (!activePolls.has(guildId)) return message.reply('❌ Không có bình chọn!');
        await endPoll(message.client, guildId, message.channel);
        return;
    }

    if (activePolls.has(guildId)) {
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?voteyentiec end` để kết thúc.');
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
        timeout: setTimeout(() => endPoll(message.client, guildId, message.channel), hours * 3600000)
    });

    try { await message.delete(); } catch (e) { }
}

module.exports = {
    name: 'voteyentiec',
    aliases: [],
    description: 'Bình chọn giờ Yến Tiệc',
    execute,
    handleVote,
    handleButton,
    activePolls
};
