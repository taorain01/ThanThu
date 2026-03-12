/**
 * ?loto / ?lt - Random số lô tô 1-90 với animation "Bốc Từ Túi" + TTS
 * 
 * Khi gọi lần đầu:
 *   - Gửi embed sàn (danh sách số đã bốc) + embed animation
 *   - Sau animation → xoá embed animation, cập nhật embed sàn
 *   - Embed sàn có nút: Bốc Số, KINH, Auto, Dừng Auto
 *   - Chỉ nhà cái (người đầu tiên gọi) được sử dụng
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ttsService = require('../../utils/ttsService');
const lotoState = require('./lotoState');

const { getAnimation } = require('./lotoAnimations');

// ============== ANIMATION CONFIG ==============
const FRAME_INTERVAL = 90;  // ms giữa mỗi frame (nhanh 50%)
const TOTAL_FRAMES = 7;     // 7 frames × 90ms ≈ 0.6s

// ============== HELPERS ==============

/**
 * Chuyển số thành text tiếng Việt để TTS đọc
 */
function numberToVietnamese(num) {
    const ones = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

    if (num < 10) return ones[num];

    const tens = Math.floor(num / 10);
    const unit = num % 10;

    let result = '';

    if (tens === 1) {
        result = 'mười';
    } else {
        result = ones[tens] + ' mươi';
    }

    if (unit === 0) {
        // không thêm gì
    } else if (unit === 1 && tens > 1) {
        result += ' mốt';
    } else if (unit === 4 && tens > 1) {
        result += ' tư';
    } else if (unit === 5) {
        result += ' lăm';
    } else {
        result += ' ' + ones[unit];
    }

    return result;
}

/**
 * Lấy phase hiện tại theo frame number
 * @param {Array} animationSet Set animation hiện tại
 * @param {number} frameNum Frame hiện tại
 */
function getPhase(animationSet, frameNum) {
    for (const phase of animationSet) {
        if (phase.frames.includes(frameNum)) return phase;
    }
    return animationSet[0];
}

/**
 * Tạo embed animation cho 1 frame
 */
function createAnimationEmbed(frameNum, randomNum, finalNum, session, animationSet) {
    const phase = getPhase(animationSet, frameNum);
    const isFinal = frameNum === TOTAL_FRAMES;

    const embed = new EmbedBuilder();

    if (isFinal) {
        embed.setColor('#22C55E')
            .setTitle('🎊 Lô Tô')
            .setDescription([
                `## ✨ ${finalNum} ✨`,
                '',
                `> 🎤 *"Số ${numberToVietnamese(finalNum)}"*`,
                '',
                phase.text ? `_${phase.text}_` : ''
            ].join('\n'));
    } else {
        embed.setColor('#3B82F6')
            .setTitle('🎰 Lô Tô')
            .setDescription([
                `### ${phase.emoji} ${phase.text}`,
                '',
                `## 🔮 ${randomNum} 🔮`,
            ].join('\n'));
    }

    return embed;
}

/**
 * Tạo embed sàn số (board) với danh sách đã bốc được gom nhóm theo hàng chục (0x, 1x...)
 */
function createBoardEmbed(session, guildId) {
    const drawnCount = session.drawnNumbers.length;

    // Sort và gom nhóm theo hàng chục
    const sortedNums = [...session.drawnNumbers].sort((a, b) => a - b);
    const groups = {};

    // Khởi tạo các nhóm từ 0-8 (hàng chục) và 9 (số 90)
    for (let i = 0; i <= 9; i++) {
        groups[i] = [];
    }

    // Phân loại số vào nhóm
    sortedNums.forEach(num => {
        const groupIndex = Math.floor(num / 10);
        // Xử lý đặc biệt cho số 90 (để nó vào nhóm riêng hoặc nhóm 9)
        // Nếu muốn 1-9, 10-19... thì:
        // 1-9 -> nhóm 0
        // 10-19 -> nhóm 1
        // ...
        // 90 -> nhóm 9
        // Math.floor(num / 10) sẽ cho:
        // 1-9 -> 0
        // 10-19 -> 1
        // ...
        // 90 -> 9
        // Tuy nhiên số 10 -> vào nhóm 1. Vậy nên logic này đúng rồi.
        const idx = num === 90 ? 9 : Math.floor(num / 10);
        if (groups[idx]) groups[idx].push(num);
    });

    // Tạo text hiển thị
    let drawnText = '';
    if (drawnCount === 0) {
        drawnText = '_Chưa bốc số nào_';
    } else {
        const lines = [];
        for (let i = 0; i <= 9; i++) {
            const nums = groups[i];
            if (nums.length > 0) {
                // Label hàng: "0x |", "1x |", ... "90 |"
                let label = i === 9 ? '90' : `${i}x`;
                // Format số: 01 05 ...
                const numStr = nums.map(n => String(n).padStart(2, '0')).join('  ');
                // Format dòng: `label` | `numbers`
                lines.push(`\`${label.padEnd(2)}\` | \`${numStr}\``);
            }
        }
        drawnText = lines.join('\n');
    }

    // Số mới nhất (highlight)
    const latestNum = drawnCount > 0 ? session.drawnNumbers[drawnCount - 1] : null;
    const latestText = latestNum ? `## 🎯 Số vừa bốc: **${latestNum}**` : '';

    const dealer = lotoState.getDealer(guildId);

    const embed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle('🎰 Sàn Lô Tô')
        .setDescription([
            latestText,
            '',
            `**Đã bốc (${drawnCount}):**`,
            drawnText
        ].filter(Boolean).join('\n'))
        .setFooter({ text: `🎩 Nhà cái: ${dealer?.name || '???'}` })
        .setTimestamp();

    return embed;
}

/**
 * Tạo buttons cho embed sàn
 */
function createBoardButtons(guildId, isAutoRunning = false) {
    const row = new ActionRowBuilder();

    if (isAutoRunning) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`loto_stop_${guildId}`)
                .setLabel('⏹️ Dừng Auto')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`loto_kinh_${guildId}`)
                .setLabel('📢 KINH')
                .setStyle(ButtonStyle.Success)
        );
    } else {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`loto_draw_${guildId}`)
                .setLabel('🎲 Bốc Số')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`loto_auto_${guildId}`)
                .setLabel('🔄 Auto')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`loto_kinh_${guildId}`)
                .setLabel('📢 KINH')
                .setStyle(ButtonStyle.Success)
        );
    }

    return row;
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== AUTO-JOIN VOICE ==============

async function autoJoinVoice(message, guildId) {
    if (ttsService.isConnected(guildId)) return;

    const userVoiceChannel = message.member?.voice?.channel;
    if (userVoiceChannel) {
        try {
            await ttsService.joinChannel(userVoiceChannel);
            await message.channel.send(`🔊 Đã vào **${userVoiceChannel.name}** để đọc số!`).then(m => {
                setTimeout(() => m.delete().catch(() => { }), 3000);
            });
        } catch (e) {
            console.error('[Loto] Auto-join voice failed:', e.message);
        }
    }
}

// ============== ANIMATION ==============

/**
 * Chạy animation bốc 1 số, trả về number
 */
async function runDrawAnimation(channel, guildId) {
    const lotoHandlers = require('../../utils/lotoHandlers');

    // Xóa animation embed cũ (nếu có) trước khi tạo mới
    await lotoHandlers.cancelAnimation(channel, guildId);

    const session = lotoState.getSession(guildId);

    // Bốc số trước
    const finalNum = lotoState.drawNumber(guildId);
    if (finalNum === null) return null;

    // Random chọn animation set
    const animationSet = getAnimation(finalNum);

    // Frame 1: gửi tin nhắn animation
    const randomNum = String(Math.floor(Math.random() * 90) + 1).padStart(2, '0');
    const firstEmbed = createAnimationEmbed(1, randomNum, finalNum, session, animationSet);
    let animMsg;
    try {
        animMsg = await channel.send({ embeds: [firstEmbed] });
    } catch (e) {
        return finalNum; // Không gửi được → bỏ qua animation
    }

    // Track animation message để có thể cancel
    lotoHandlers.setAnimationMessage(guildId, animMsg.id);

    // Các frame tiếp theo
    let cancelled = false;
    for (let frame = 2; frame <= TOTAL_FRAMES; frame++) {
        await sleep(FRAME_INTERVAL);

        // Kiểm tra animation có bị huỷ bởi KINH không
        // (nếu message đã bị xoá thì không edit nữa)
        if (!lotoHandlers.isAnimationTracked(guildId, animMsg.id)) {
            cancelled = true;
            break;
        }

        let displayNum;
        if (frame === TOTAL_FRAMES) {
            displayNum = String(finalNum).padStart(2, '0');
        } else if (frame === TOTAL_FRAMES - 1) {
            displayNum = '??';
        } else {
            displayNum = String(Math.floor(Math.random() * 90) + 1).padStart(2, '0');
        }

        const embed = createAnimationEmbed(frame, displayNum, finalNum, session, animationSet);
        try {
            await animMsg.edit({ embeds: [embed] });
        } catch (e) {
            // Message đã bị xoá (KINH cancel) → dừng animation
            cancelled = true;
            break;
        }

        if (frame === TOTAL_FRAMES - 1) {
            await sleep(200);
        }
    }

    // Nếu animation bị huỷ bởi KINH → không TTS, return null
    if (cancelled) {
        return null;
    }

    // TTS đọc số
    if (ttsService.isConnected(guildId)) {
        const text = `Số ${numberToVietnamese(finalNum)}`;
        await ttsService.speak(guildId, text);
    }

    // Giữ animation embed hiển thị - không xóa
    // (sẽ bị xóa khi bốc số tiếp hoặc khi KINH cancel)

    return finalNum;
}

/**
 * Cập nhật embed sàn
 */
async function updateBoardEmbed(channel, guildId) {
    const session = lotoState.getSession(guildId);
    if (!session.boardMessageId) return;

    try {
        const boardMsg = await channel.messages.fetch(session.boardMessageId);
        if (boardMsg) {
            const boardEmbed = createBoardEmbed(session, guildId);
            const isAuto = lotoState.isAutoRunning(guildId);
            const row = createBoardButtons(guildId, isAuto);
            await boardMsg.edit({ embeds: [boardEmbed], components: [row] });
        }
    } catch (e) {
        console.error('[Loto] Failed to update board:', e.message);
    }
}

// ============== MAIN EXECUTE ==============

const ADMIN_ID = '395151484179841024';
const DRAW_COOLDOWN_MS = 2000; // 2 giây cooldown giữa các lần bốc

// Track last draw time per guild
const lastDrawTime = new Map();

async function execute(message, args) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    // ========= ?lt on / ?lt off (Admin only) =========
    if (args[0] === 'on') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Chỉ admin mới được bật/tắt lô tô!');
        }
        lotoState.enableLoto();
        return message.reply('✅ Đã **BẬT** hệ thống Lô Tô! Mọi người có thể chơi.');
    }

    if (args[0] === 'off') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Chỉ admin mới được bật/tắt lô tô!');
        }
        lotoState.disableLoto();
        // Dừng auto nếu đang chạy
        lotoState.stopAuto(guildId);
        return message.reply('⛔ Đã **TẮT** hệ thống Lô Tô! Tất cả lệnh lô tô bị vô hiệu hóa.');
    }

    // ========= Kiểm tra loto có được bật không =========
    if (!lotoState.isLotoEnabled()) {
        return; // Không phản hồi khi loto tắt
    }

    // ========= Kiểm tra bot đã vào voice chưa (phải ?join trước) =========
    if (!ttsService.isConnected(guildId)) {
        return; // Bot chưa vào voice → không phản hồi
    }

    // ========= Kiểm tra tin nhắn phải từ kênh text của voice channel bot đang ở =========
    const { getVoiceConnection } = require('@discordjs/voice');
    const connection = getVoiceConnection(guildId);
    if (connection) {
        const botVoiceChannelId = connection.joinConfig.channelId;
        // Tin nhắn phải từ kênh chat của voice channel đó
        if (message.channel.id !== botVoiceChannelId) {
            return; // Không phải kênh chat voice → không phản hồi
        }
    }

    const session = lotoState.getSession(guildId);

    // Kiểm tra nhà cái
    if (session.dealerId && session.dealerId !== message.author.id) {
        return message.reply(`❌ Hiện tại <@${session.dealerId}> đang là nhà cái! Chỉ nhà cái mới được bốc số.`);
    }

    // Set nhà cái nếu chưa có
    lotoState.setDealer(guildId, message.author.id, message.author.username);

    // ========= Kiểm tra cooldown (2 giây giữa các lần bốc) =========
    const now = Date.now();
    const lastDraw = lastDrawTime.get(guildId) || 0;
    const timeSinceLastDraw = now - lastDraw;

    if (timeSinceLastDraw < DRAW_COOLDOWN_MS) {
        // Còn trong cooldown → xoá lệnh
        return message.delete().catch(() => { });
    }

    // Update last draw time
    lastDrawTime.set(guildId, now);

    // Kiểm tra hết số
    if (session.availableNumbers.size === 0) {
        return message.reply('❌ Đã hết số! Dùng `?lte` để reset ván mới.');
    }

    // Nếu chưa có embed sàn → gửi embed sàn lần đầu
    if (!session.boardMessageId) {
        // Set channel topic khi bắt đầu ván loto
        try {
            await message.channel.setTopic('CHƠI LOTO KHÔNG NGHIỆN ĐÂU!!!');
        } catch (e) {
            // Bỏ qua nếu bot không có quyền set topic
        }

        const boardEmbed = createBoardEmbed(session, guildId);
        const row = createBoardButtons(guildId);
        const boardMsg = await message.channel.send({ embeds: [boardEmbed], components: [row] });
        lotoState.setBoardMessage(guildId, boardMsg.id, message.channel.id);

        // Xoá tin nhắn command
        await message.delete().catch(() => { });

        // Bốc số + animation (lần đầu tiên)
        const num = await runDrawAnimation(message.channel, guildId);
        if (num === null) return;

        // Cập nhật embed sàn
        await updateBoardEmbed(message.channel, guildId);
    } else {
        // Đã có board rồi → chỉ cho phép dùng nút "Bốc Số", không cho dùng lệnh ?lt nữa
        // Xoá lệnh ?lt
        await message.delete().catch(() => { });
    }
}

module.exports = {
    execute,
    runDrawAnimation,
    updateBoardEmbed,
    createBoardEmbed,
    createBoardButtons,
    numberToVietnamese,
    autoJoinVoice
};
