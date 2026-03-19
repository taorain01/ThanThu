const { EmbedBuilder } = require('discord.js');

// Lưu danh sách args theo channelId để ?rrteam dùng lại
const lastTeamArgs = new Map();

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

/**
 * Tạo embed kết quả chia đội
 */
function buildTeamEmbed(players, requester, isReroll = false) {
    const shuffledPlayers = shuffle([...players]);
    const team1 = shuffledPlayers.slice(0, 5);
    const team2 = shuffledPlayers.slice(5, 10);

    const embed = new EmbedBuilder()
        .setColor(isReroll ? 0xFFA500 : 0x00FFFF)
        .setTitle(isReroll ? '🔄 RANDOM LẠI CHIA ĐỘI' : '🎲 KẾT QUẢ RANDOM CHIA ĐỘI')
        .setDescription(isReroll
            ? 'Đã random lại 2 đội từ danh sách trước đó!'
            : 'Đã chia 10 người thành 2 đội ngẫu nhiên hoàn toàn!')
        .addFields(
            {
                name: '⚔️ ĐỘI 1',
                value: team1.map((p, i) => `**${i + 1}.** ${p}`).join('\n'),
                inline: true
            },
            {
                name: '🛡️ ĐỘI 2',
                value: team2.map((p, i) => `**${i + 1}.** ${p}`).join('\n'),
                inline: true
            }
        )
        .setTimestamp()
        .setFooter({ text: `Yêu cầu bởi ${requester.username}`, iconURL: requester.displayAvatarURL() });

    return embed;
}

/**
 * Sắp xếp member trong voice theo bảng chữ cái (displayName)
 * — khớp với thứ tự Discord hiển thị trong voice channel
 */
function sortVoiceMembers(membersCollection) {
    return [...membersCollection.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
    );
}

/**
 * ?rteam command - Random 10 players into 2 teams
 * - Không args: auto-detect từ voice (cần đúng 10 người, không tính bot)
 * - Args toàn số: chọn theo STT trong voice (tính cả bot khi đếm, nhưng bot không được chọn)
 * - Args là tên/tag: nhập thủ công đúng 10 người
 */
async function execute(message, args) {
    let players = args;

    // Kiểm tra tất cả args có phải số không
    const allNumbers = args.length > 0 && args.every(a => /^\d+$/.test(a));

    if (args.length === 0) {
        // === CHẾ ĐỘ 1: Auto-detect toàn bộ voice ===
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('❌ Bạn cần ở trong **voice channel** hoặc nhập thủ công 10 người!\nVí dụ: `?rteam @A @B @C @D @E @F @G @H @I @J`');
        }

        const members = voiceChannel.members.filter(m => !m.user.bot);
        if (members.size !== 10) {
            return message.reply(`❌ Voice channel hiện có **${members.size}** người (không tính bot), cần đúng **10** người!`);
        }

        players = members.map(m => `<@${m.id}>`);

    } else if (allNumbers) {
        // === CHẾ ĐỘ 2: Chọn theo số thứ tự trong voice ===
        const positions = args.map(Number);

        if (positions.length !== 10) {
            return message.reply('❌ Cần nhập đúng **10** số thứ tự!\nVí dụ: `?rteam 1 2 3 4 5 7 8 9 10 11`');
        }

        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('❌ Bạn cần ở trong **voice channel** để dùng chế độ chọn theo STT!');
        }

        // Sắp xếp theo thứ tự Discord hiển thị (tính cả bot)
        const sorted = sortVoiceMembers(voiceChannel.members);
        const totalInVoice = sorted.length;

        // Validate số thứ tự
        const invalid = positions.filter(p => p < 1 || p > totalInVoice);
        if (invalid.length > 0) {
            return message.reply(`❌ Số thứ tự không hợp lệ: **${invalid.join(', ')}** (voice có ${totalInVoice} người)`);
        }

        const duplicate = positions.filter((p, i) => positions.indexOf(p) !== i);
        if (duplicate.length > 0) {
            return message.reply(`❌ Số thứ tự bị trùng: **${[...new Set(duplicate)].join(', ')}**`);
        }

        // Pick member theo vị trí, check bot
        const picked = [];
        const botPositions = [];
        for (const pos of positions) {
            const member = sorted[pos - 1];
            if (member.user.bot) {
                botPositions.push(`#${pos} (${member.displayName})`);
            } else {
                picked.push(`<@${member.id}>`);
            }
        }

        if (botPositions.length > 0) {
            return message.reply(`❌ Vị trí sau là bot, không thể chọn: **${botPositions.join(', ')}**`);
        }

        players = picked;

    } else {
        // === CHẾ ĐỘ 3: Nhập thủ công tên/tag ===
        if (args.length !== 10) {
            return message.reply('❌ Vui lòng nhập đúng **10** người!\nVí dụ: `?rteam @A @B @C @D @E @F @G @H @I @J`');
        }
    }

    // Lưu lại danh sách để ?rrteam dùng
    lastTeamArgs.set(message.channel.id, [...players]);

    const embed = buildTeamEmbed(players, message.author, false);
    return message.channel.send({ embeds: [embed] });
}

/**
 * ?rrteam command - Random lại từ kết quả ?rteam trước đó
 */
async function reroll(message) {
    const saved = lastTeamArgs.get(message.channel.id);
    if (!saved) {
        return message.reply('❌ Chưa có dữ liệu chia đội trước đó! Hãy dùng `?rteam` trước.');
    }

    const embed = buildTeamEmbed(saved, message.author, true);
    return message.channel.send({ embeds: [embed] });
}

module.exports = { execute, reroll, lastTeamArgs };
