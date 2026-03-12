// Bangchien (Bang Chiến) Notification State
// Lưu trữ trạng thái thông báo Bang Chiến - Giống bossguild nhưng cho 30 người

// Map lưu trữ thông báo đang chạy
// Key: `${guildId}_${leaderId}`, Value: { intervalId, channelId, leaderId, messageId, message, startTime }
const bangchienNotifications = new Map();

// Map lưu danh sách đăng ký (KHÔNG GIỚI HẠN - khác bossguild)
// Key: `${guildId}_${leaderId}`, Value: [{ id, username, joinedAt }]
const bangchienRegistrations = new Map();

// Số người tối đa mỗi party
const BANGCHIEN_MAX_MEMBERS = 30;

// Giới hạn số party tối đa mỗi guild (1 T7 + 1 CN = 2)
const BANGCHIEN_MAX_PARTIES = 2;

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-DAY CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Cấu hình các ngày BC (tên cơ bản, dùng getDayNameWithDate để lấy tên kèm ngày)
const DAY_CONFIG = {
    sat: { name: 'Thứ 7', color: 0x00CED1, emoji: '📅' },   // Xanh nước biển
    sun: { name: 'Chủ Nhật', color: 0x87CEEB, emoji: '📅' } // Xanh da trời
};

/**
 * Tính ngày Thứ 7 hoặc Chủ Nhật của tuần này (hoặc tuần tới nếu đã qua)
 * @param {'sat' | 'sun'} day - 'sat' hoặc 'sun'
 * @returns {Date} Ngày cụ thể
 */
function getNextDayDate(day) {
    const now = new Date();
    // Convert to Vietnam timezone (UTC+7)
    const vnOffset = 7 * 60; // minutes
    const localOffset = now.getTimezoneOffset();
    const vnNow = new Date(now.getTime() + (vnOffset + localOffset) * 60 * 1000);

    const currentDay = vnNow.getDay(); // 0=CN, 1-6=T2-T7
    const targetDay = day === 'sat' ? 6 : 0; // 6=Thứ 7, 0=Chủ Nhật

    let daysUntilTarget;
    if (targetDay === 0) {
        // Chủ Nhật
        daysUntilTarget = (7 - currentDay) % 7;
        if (daysUntilTarget === 0 && vnNow.getHours() < 23) {
            daysUntilTarget = 0; // Vẫn trong ngày CN hôm nay
        } else if (daysUntilTarget === 0) {
            daysUntilTarget = 7; // Đã qua CN, lấy CN tuần sau
        }
    } else {
        // Thứ 7
        daysUntilTarget = (targetDay - currentDay + 7) % 7;
        if (daysUntilTarget === 0 && vnNow.getHours() < 23) {
            daysUntilTarget = 0; // Vẫn trong ngày T7 hôm nay
        } else if (daysUntilTarget === 0) {
            daysUntilTarget = 7; // Đã qua T7, lấy T7 tuần sau
        }
    }

    const targetDate = new Date(vnNow);
    targetDate.setDate(vnNow.getDate() + daysUntilTarget);
    return targetDate;
}

/**
 * Lấy tên ngày kèm ngày cụ thể, ví dụ: "Thứ 7 (01/02/2026)"
 * @param {'sat' | 'sun'} day - 'sat' hoặc 'sun'
 * @returns {string} Tên ngày với ngày cụ thể
 */
function getDayNameWithDate(day) {
    if (!day || !DAY_CONFIG[day]) return '';

    const targetDate = getNextDayDate(day);
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yyyy = targetDate.getFullYear();

    return `${DAY_CONFIG[day].name} (${dd}/${mm}/${yyyy})`;
}

// Aliases cho ngày (để parse từ args)
const DAY_ALIASES = {
    't7': 'sat', 'sat': 'sat', 'saturday': 'sat', 'thu7': 'sat', 'thứ7': 'sat',
    'cn': 'sun', 'sun': 'sun', 'sunday': 'sun', 'chunhat': 'sun', 'chủnhật': 'sun'
};

// Helper: Parse day từ args
function parseDayArg(args) {
    if (!args || args.length === 0) return null;

    for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i]?.toLowerCase();
        if (DAY_ALIASES[arg]) {
            return DAY_ALIASES[arg];
        }
    }
    return null;
}

// Helper: Lấy day từ party key (format: guildId_day_leaderId)
function getDayFromPartyKey(partyKey) {
    const parts = partyKey.split('_');
    if (parts.length >= 3) {
        // Format mới: guildId_day_leaderId
        const day = parts[1];
        if (day === 'sat' || day === 'sun') return day;
    }
    // Format cũ hoặc không có day
    return null;
}

// Helper: Tạo party key mới với day
function createPartyKey(guildId, day, leaderId) {
    return `${guildId}_${day}_${leaderId}`;
}

// Helper: Lấy tất cả party keys của một guild
function getGuildBangchienKeys(guildId) {
    const keys = [];
    for (const key of bangchienNotifications.keys()) {
        if (key.startsWith(`${guildId}_`)) {
            keys.push(key);
        }
    }
    return keys;
}

// Helper: Kiểm tra user đã đăng ký party nào chưa
function getUserBangchienParty(guildId, userId) {
    for (const [key, registrations] of bangchienRegistrations) {
        if (key.startsWith(`${guildId}_`)) {
            if (registrations.some(r => r.id === userId)) {
                return key;
            }
        }
    }
    return null;
}

// Map lưu danh sách đã chốt (để reply tag)
// Key: messageId của embed chốt, Value: { leaderId, participants: [{ id, username }], guildId }
const bangchienFinalizedParties = new Map();

// ID kênh bangchien (để biết kênh nào cần theo dõi)
// Key: guildId, Value: channelId
const bangchienChannels = new Map();

// Map lưu overview messages (để auto-refresh và update)
// Key: guildId, Value: { messageId, channelId, message }
const bangchienOverviews = new Map();

// Map lưu timer debounce refresh cho BC overview
// Key: guildId, Value: timeoutId
const bcRefreshTimers = new Map();

// Thời gian debounce refresh BC overview (5 phút)
const BC_REFRESH_DEBOUNCE = 5 * 60 * 1000;

// Map lưu listbc detail messages (để real-time refresh)
// Key: `${guildId}_${day}`, Value: { message, messageId, channelId }
const listbcDetailMessages = new Map();

/**
 * Refresh overview embed ở kênh ?bc (xóa cũ, gửi mới)
 * Dùng chung cho tất cả handlers khi có thay đổi dữ liệu BC
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 */
async function refreshOverviewEmbed(client, guildId) {
    const overviewData = bangchienOverviews.get(guildId);
    if (!overviewData) return;

    try {
        const { createOverviewEmbed, createOverviewButton } = require('../commands/bangchien/bangchien');
        const newEmbed = createOverviewEmbed(guildId);
        const newRow = createOverviewButton(guildId);

        // Thử edit trước (nhanh hơn)
        if (overviewData.message) {
            try {
                const editOptions = { embeds: [newEmbed] };
                if (newRow) editOptions.components = [newRow];
                else editOptions.components = [];
                await overviewData.message.edit(editOptions);
                return;
            } catch (e) {
                // Message không còn tồn tại → xóa và gửi mới
            }
        }

        // Fallback: gửi message mới vào channel overview
        const channel = await client.channels.fetch(overviewData.channelId).catch(() => null);
        if (!channel) return;

        const sendOptions = { embeds: [newEmbed] };
        if (newRow) sendOptions.components = [newRow];
        const newMessage = await channel.send(sendOptions);

        overviewData.messageId = newMessage.id;
        overviewData.message = newMessage;
    } catch (e) {
        console.error('[bangchienState] Error refreshing overview:', e.message);
    }
}

module.exports = {
    // Maps
    bangchienNotifications,
    bangchienRegistrations,
    bangchienFinalizedParties,
    bangchienChannels,
    bangchienOverviews,
    listbcDetailMessages,
    bcRefreshTimers,
    // Constants
    BANGCHIEN_MAX_MEMBERS,
    BANGCHIEN_MAX_PARTIES,
    BC_REFRESH_DEBOUNCE,
    // Multi-day config
    DAY_CONFIG,
    DAY_ALIASES,
    // Helper functions
    parseDayArg,
    getDayFromPartyKey,
    createPartyKey,
    getGuildBangchienKeys,
    getUserBangchienParty,
    getNextDayDate,
    getDayNameWithDate,
    refreshOverviewEmbed
};
