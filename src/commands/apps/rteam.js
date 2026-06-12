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
    // Chia cân bằng theo số người thực tế: 10 -> 5/5, 9 -> 5/4, 7 -> 4/3...
    const half = Math.ceil(shuffledPlayers.length / 2);
    const team1 = shuffledPlayers.slice(0, half);
    const team2 = shuffledPlayers.slice(half);

    const embed = new EmbedBuilder()
        .setColor(isReroll ? 0xFFA500 : 0x00FFFF)
        .setTitle(isReroll ? '🔄 RANDOM LẠI CHIA ĐỘI' : '🎲 KẾT QUẢ RANDOM CHIA ĐỘI')
        .setDescription(isReroll
            ? `Đã random lại 2 đội (${team1.length} vs ${team2.length}) từ danh sách trước đó!`
            : `Đã chia ${shuffledPlayers.length} người thành 2 đội ngẫu nhiên (${team1.length} vs ${team2.length})!`)
        .addFields(
            {
                name: `⚔️ ĐỘI 1 (${team1.length})`,
                value: team1.map((p, i) => `**${i + 1}.** ${p}`).join('\n'),
                inline: true
            },
            {
                name: `🛡️ ĐỘI 2 (${team2.length})`,
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

function formatMention(userId) {
    return `<@${userId}>`;
}

function unique(values) {
    return [...new Set(values)];
}

function getTargetUserIds(message, args) {
    const ids = [];
    for (const arg of args) {
        const mentionMatch = arg.match(/^<@!?(\d{15,25})>$/);
        const rawIdMatch = arg.match(/^(\d{15,25})$/);
        const id = mentionMatch?.[1] || rawIdMatch?.[1];
        if (id) ids.push(id);
    }
    for (const user of message.mentions.users.values()) {
        ids.push(user.id);
    }
    return unique(ids);
}

function getVoicePlayerIds(message) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return { voiceChannel: null, playerIds: [] };
    const playerIds = voiceChannel.members
        .filter(member => !member.user.bot)
        .map(member => member.id);
    return { voiceChannel, playerIds };
}

async function sendTeamFromPool(message, playerIds) {
    const players = unique(playerIds).map(formatMention);
    if (players.length < 2) {
        return message.reply(`❌ Cần ít nhất **2** người để random, hiện chỉ có **${players.length}** người.`);
    }

    lastTeamArgs.set(message.channel.id, [...players]);

    const embed = buildTeamEmbed(players, message.author, false);
    return message.channel.send({ embeds: [embed] });
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
            return message.reply('❌ Bạn cần ở trong **voice channel** hoặc nhập thủ công người chơi!\nVí dụ: `?rteam @A @B @C @D ...`');
        }

        const members = voiceChannel.members.filter(m => !m.user.bot);
        if (members.size < 2) {
            return message.reply(`❌ Voice channel cần ít nhất **2** người (không tính bot) để chia đội, hiện có **${members.size}**!`);
        }

        players = members.map(m => `<@${m.id}>`);

    } else if (allNumbers) {
        // === CHẾ ĐỘ 2: Chọn theo số thứ tự trong voice ===
        const positions = args.map(Number);

        if (positions.length < 2) {
            return message.reply('❌ Cần nhập ít nhất **2** số thứ tự!\nVí dụ: `?rteam 1 2 3 4 5 7 8 9 10`');
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
        if (args.length < 2) {
            return message.reply('❌ Vui lòng nhập ít nhất **2** người!\nVí dụ: `?rteam @A @B @C @D ...`');
        }
    }

    // Lưu lại danh sách để ?rrteam dùng
    lastTeamArgs.set(message.channel.id, [...players]);

    const embed = buildTeamEmbed(players, message.author, false);
    return message.channel.send({ embeds: [embed] });
}

/**
 * ?rt- @user @user2 - Loại user khỏi pool voice rồi random 10 người.
 */
async function executeMinus(message, args) {
    if (args.length === 0) {
        return message.reply('❌ Cách dùng: `?rt- @user @user2` để loại người khỏi voice trước khi random.');
    }

    const { voiceChannel, playerIds } = getVoicePlayerIds(message);
    if (!voiceChannel) {
        return message.reply('❌ Bạn cần ở trong **voice channel** để dùng `?rt-`.');
    }

    const excludedIds = getTargetUserIds(message, args);
    if (excludedIds.length === 0) {
        return message.reply('❌ Không tìm thấy user cần loại. Hãy mention user hoặc nhập Discord ID.');
    }

    const excluded = new Set(excludedIds);
    const pool = playerIds.filter(id => !excluded.has(id));
    return sendTeamFromPool(message, pool);
}

/**
 * ?rt+ @user @user2 - Thêm user vào pool voice rồi random 10 người.
 */
async function executePlus(message, args) {
    if (args.length === 0) {
        return message.reply('❌ Cách dùng: `?rt+ @user @user2` để thêm người vào pool random.');
    }

    const { voiceChannel, playerIds } = getVoicePlayerIds(message);
    if (!voiceChannel) {
        return message.reply('❌ Bạn cần ở trong **voice channel** để dùng `?rt+`.');
    }

    const addedIds = getTargetUserIds(message, args);
    if (addedIds.length === 0) {
        return message.reply('❌ Không tìm thấy user cần thêm. Hãy mention user hoặc nhập Discord ID.');
    }

    return sendTeamFromPool(message, [...playerIds, ...addedIds]);
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

module.exports = { execute, executeMinus, executePlus, reroll, lastTeamArgs };
