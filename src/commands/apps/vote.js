/**
 * ?vote [giờ] [nội dung 1] [nội dung 2] ... - Tạo bình chọn tùy chỉnh
 * 
 * Usage:
 * - ?vote 2 Ăn phở Ăn cơm Ăn mì   → Bình chọn 2 giờ với 3 lựa chọn
 * - ?vote 24 Đồng ý Không đồng ý    → Bình chọn 24 giờ, 2 lựa chọn
 * - ?vote end                         → Kết thúc bình chọn đang chạy
 * 
 * Tối thiểu 2 lựa chọn, tối đa 25 (giới hạn Discord select menu)
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Emoji mặc định cho các lựa chọn
const OPTION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
    '🅰️', '🅱️', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴'];

// Lưu poll và vote theo guildId
const activePolls = new Map();
const pollVotes = new Map();

function createProgressBar(pct, len = 10) {
    const f = Math.round((pct / 100) * len);
    return '█'.repeat(f) + '░'.repeat(len - f);
}

function calculateResults(guildId) {
    const gv = pollVotes.get(guildId);
    if (!gv) return { results: [], total: 0 };
    const counts = {};
    for (const v of Object.values(gv)) counts[v] = (counts[v] || 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    // Lấy danh sách options ban đầu để hiển thị cả option 0 vote
    const poll = activePolls.get(guildId);
    const allOptions = poll ? poll.options : [];

    const results = allOptions.map(opt => {
        const count = counts[opt] || 0;
        return {
            value: opt,
            count,
            pct: total > 0 ? Math.round((count / total) * 100) : 0
        };
    }).sort((a, b) => b.count - a.count);

    return { results, total };
}

function createResultEmbed(guildId) {
    const poll = activePolls.get(guildId);
    const { results, total } = calculateResults(guildId);
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 KẾT QUẢ BÌNH CHỌN')
        .setTimestamp();

    if (results.length === 0) {
        embed.setDescription('Chưa có ai vote');
    } else {
        const lines = [];
        if (poll) lines.push(`**${poll.title || 'Bình chọn'}**\n`);
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const emoji = OPTION_EMOJIS[poll?.options.indexOf(r.value)] || '▪️';
            const winner = i === 0 && r.count > 0 ? ' 👑' : '';
            lines.push(`${emoji} **${r.value}**${winner}\n${createProgressBar(r.pct)} ${r.count} vote (${r.pct}%)`);
        }
        embed.setDescription(lines.join('\n'));
    }
    embed.setFooter({ text: `👥 ${total} người tham gia` });
    return embed;
}

function createPollEmbed(guildId) {
    const poll = activePolls.get(guildId);
    if (!poll) return null;
    const { total } = calculateResults(guildId);

    // Hiển thị danh sách options
    const optionLines = poll.options.map((opt, i) => {
        const emoji = OPTION_EMOJIS[i] || '▪️';
        return `${emoji} ${opt}`;
    });

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🗳️ BÌNH CHỌN')
        .setDescription([
            `**${poll.title || 'Chọn một lựa chọn bên dưới'}**`,
            '',
            optionLines.join('\n'),
            '',
            '━━━━━━━━━━━━━━━━━━━━━',
        ].join('\n'))
        .addFields(
            { name: '⏰ Kết thúc', value: `<t:${Math.floor(poll.endTime / 1000)}:R>`, inline: true },
            { name: '👥 Đã vote', value: `${total} người`, inline: true },
        )
        .setFooter({ text: `Tạo bởi ${poll.creatorName} • Chọn từ menu bên dưới` })
        .setTimestamp();
}

function createMenuAndButtons(guildId) {
    const poll = activePolls.get(guildId);
    if (!poll) return [];

    const menu = new StringSelectMenuBuilder()
        .setCustomId('votecustom_select')
        .setPlaceholder('🗳️ Chọn câu trả lời của bạn...')
        .addOptions(poll.options.map((opt, i) => ({
            label: opt.length > 100 ? opt.substring(0, 97) + '...' : opt,
            value: opt,
            emoji: OPTION_EMOJIS[i] || undefined,
        })));

    return [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('votecustom_result').setLabel('📊 Kết quả').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('votecustom_end').setLabel('🛑 Kết thúc').setStyle(ButtonStyle.Danger)
        )
    ];
}

// ═══ INTERACTION HANDLERS ═══

async function handleVote(interaction) {
    const guildId = interaction.guild.id;
    if (!activePolls.has(guildId)) {
        return interaction.reply({ content: '❌ Không có bình chọn đang chạy!', ephemeral: true });
    }

    if (!pollVotes.has(guildId)) pollVotes.set(guildId, {});
    const previousVote = pollVotes.get(guildId)[interaction.user.id];
    pollVotes.get(guildId)[interaction.user.id] = interaction.values[0];

    const replyText = previousVote
        ? `✅ Đã đổi vote thành **${interaction.values[0]}**! (trước: ${previousVote})`
        : `✅ Đã vote **${interaction.values[0]}**!`;
    await interaction.reply({ content: replyText, ephemeral: true });

    // Cập nhật embed
    try {
        const poll = activePolls.get(guildId);
        const channel = await interaction.client.channels.fetch(poll.channelId);
        const pollMsg = await channel.messages.fetch(poll.messageId);
        await pollMsg.edit({
            embeds: [createPollEmbed(guildId)],
            components: createMenuAndButtons(guildId)
        });
    } catch (e) {
        console.error('[vote] Không thể cập nhật embed:', e);
    }
}

async function handleButton(interaction) {
    const guildId = interaction.guild.id;
    const action = interaction.customId.replace('votecustom_', '');

    if (action === 'result') {
        return interaction.reply({ embeds: [createResultEmbed(guildId)], ephemeral: true });
    }

    if (action === 'end') {
        const poll = activePolls.get(guildId);
        if (!poll) {
            return interaction.reply({ content: '❌ Không có bình chọn!', ephemeral: true });
        }
        if (poll.creatorId !== interaction.user.id) {
            return interaction.reply({ content: '❌ Chỉ người tạo bình chọn mới có thể kết thúc!', ephemeral: true });
        }
        await endPoll(interaction.client, guildId, interaction.channel);
        return interaction.reply({ content: '✅ Đã kết thúc bình chọn!', ephemeral: true });
    }
}

async function endPoll(client, guildId, channel) {
    const poll = activePolls.get(guildId);
    if (!poll) return;
    if (poll.timeout) clearTimeout(poll.timeout);

    // Cập nhật message gốc → disable
    try {
        const ch = await client.channels.fetch(poll.channelId);
        const msg = await ch.messages.fetch(poll.messageId);
        await msg.edit({
            embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('🗳️ BÌNH CHỌN ĐÃ KẾT THÚC').setTimestamp()],
            components: []
        });
    } catch (e) { }

    // Gửi kết quả ra channel
    await channel.send({ embeds: [createResultEmbed(guildId)] });

    activePolls.delete(guildId);
    pollVotes.delete(guildId);
}

// ═══ EXECUTE COMMAND ═══

async function execute(message, args) {
    const guildId = message.guild.id;

    // ?vote end → kết thúc sớm
    if (args[0]?.toLowerCase() === 'end') {
        if (!activePolls.has(guildId)) return message.reply('❌ Không có bình chọn đang chạy!');
        const poll = activePolls.get(guildId);
        if (poll.creatorId !== message.author.id) {
            return message.reply('❌ Chỉ người tạo bình chọn mới có thể kết thúc!');
        }
        await endPoll(message.client, guildId, message.channel);
        return;
    }

    // Kiểm tra đã có poll chạy chưa
    if (activePolls.has(guildId)) {
        return message.reply('❌ Đã có bình chọn đang chạy! Dùng `?vote end` để kết thúc.');
    }

    // Parse: ?vote [giờ] [option1] [option2] ...
    if (args.length < 3) {
        return message.reply([
            '❌ **Thiếu tham số!**',
            '',
            '📝 **Cách dùng:** `?vote [số giờ] [lựa chọn 1] [lựa chọn 2] ...`',
            '📌 **Ví dụ:** `?vote 2 "Ăn phở" "Ăn cơm" "Ăn mì"`',
            '',
            '💡 Dùng dấu `"..."` cho lựa chọn nhiều từ, hoặc viết liền (không dấu cách) cho lựa chọn 1 từ.',
        ].join('\n'));
    }

    // Parse số giờ
    const hoursArg = args[0];
    let hours = parseInt(hoursArg);
    if (isNaN(hours) || hours < 1) {
        return message.reply('❌ Số giờ không hợp lệ! Phải là số nguyên >= 1.');
    }
    hours = Math.min(hours, 72); // Tối đa 72 giờ

    // Parse options - hỗ trợ cả dấu ngoặc kép và không ngoặc kép
    const rawText = args.slice(1).join(' ');
    const options = [];

    // Regex: tìm text trong ngoặc kép, hoặc text không có dấu cách
    const regex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = regex.exec(rawText)) !== null) {
        options.push(match[1] || match[2]);
    }

    if (options.length < 2) {
        return message.reply('❌ Cần ít nhất **2 lựa chọn**!');
    }
    if (options.length > 25) {
        return message.reply('❌ Tối đa **25 lựa chọn** (giới hạn Discord)!');
    }

    // Kiểm tra lựa chọn trùng
    const uniqueOptions = [...new Set(options)];
    if (uniqueOptions.length !== options.length) {
        return message.reply('❌ Có lựa chọn bị trùng! Vui lòng kiểm tra lại.');
    }

    // Kiểm tra độ dài mỗi option (Discord giới hạn 100 ký tự cho select menu value)
    for (const opt of options) {
        if (opt.length > 100) {
            return message.reply(`❌ Lựa chọn quá dài (tối đa 100 ký tự): "${opt.substring(0, 30)}..."`);
        }
    }

    const endTime = Date.now() + hours * 3600000;
    pollVotes.set(guildId, {});

    // Tạo title từ tên lệnh
    const title = `Bình chọn (${hours} giờ)`;

    activePolls.set(guildId, {
        options,
        title,
        endTime,
        creatorId: message.author.id,
        creatorName: message.author.username,
        channelId: null, // sẽ set sau khi gửi
        messageId: null,
        timeout: null,
    });

    const pollMsg = await message.channel.send({
        embeds: [createPollEmbed(guildId)],
        components: createMenuAndButtons(guildId)
    });

    // Cập nhật messageId và channelId
    const poll = activePolls.get(guildId);
    poll.messageId = pollMsg.id;
    poll.channelId = message.channel.id;
    poll.timeout = setTimeout(() => endPoll(message.client, guildId, message.channel), hours * 3600000);

    try { await message.delete(); } catch (e) { }
}

module.exports = {
    name: 'vote',
    aliases: ['poll', 'binhchon'],
    description: 'Tạo bình chọn tùy chỉnh',
    execute,
    handleVote,
    handleButton,
    activePolls
};
