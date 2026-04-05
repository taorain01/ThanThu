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

// Giới hạn số party tối đa mỗi guild (T7 + CN + 5 ngày tuần = 7)
const BANGCHIEN_MAX_PARTIES = 7;

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-DAY CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Cấu hình tất cả các ngày BC
const DAY_CONFIG = {
    mon: { name: 'Thứ 2', color: 0xFF6B35, emoji: '📅' },
    tue: { name: 'Thứ 3', color: 0xE91E63, emoji: '📅' },
    wed: { name: 'Thứ 4', color: 0x9C27B0, emoji: '📅' },
    thu: { name: 'Thứ 5', color: 0x3F51B5, emoji: '📅' },
    fri: { name: 'Thứ 6', color: 0x009688, emoji: '📅' },
    sat: { name: 'Thứ 7', color: 0x00CED1, emoji: '📅', primary: true },
    sun: { name: 'Chủ Nhật', color: 0x87CEEB, emoji: '📅', primary: true }
};

// Ngày mặc định (luôn hiện trên web + overview)
const PRIMARY_DAYS = ['sat', 'sun'];

/**
 * Tính ngày Thứ 7 hoặc Chủ Nhật của tuần này (hoặc tuần tới nếu đã qua)
 * @param {'sat' | 'sun'} day - 'sat' hoặc 'sun'
 * @returns {Date} Ngày cụ thể
 */
// Map day key → getDay() value
const DAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function getNextDayDate(day) {
    if (!DAY_NUM.hasOwnProperty(day)) return new Date();
    const now = new Date();
    const vnOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const vnNow = new Date(now.getTime() + (vnOffset + localOffset) * 60 * 1000);

    const currentDay = vnNow.getDay();
    const targetDay = DAY_NUM[day];

    let daysUntilTarget = (targetDay - currentDay + 7) % 7;
    if (daysUntilTarget === 0 && vnNow.getHours() >= 23) {
        daysUntilTarget = 7;
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
    't2': 'mon', 'mon': 'mon', 'monday': 'mon', 'thu2': 'mon', 'thứ2': 'mon',
    't3': 'tue', 'tue': 'tue', 'tuesday': 'tue', 'thu3': 'tue', 'thứ3': 'tue',
    't4': 'wed', 'wed': 'wed', 'wednesday': 'wed', 'thu4': 'wed', 'thứ4': 'wed',
    't5': 'thu', 'thu5': 'thu', 'thứ5': 'thu', 'thursday': 'thu',
    // Lưu ý: 'thu' vừa là alias T5 vừa là key. Ưu tiên T5 vì args[0] thường là thứ
    't6': 'fri', 'fri': 'fri', 'friday': 'fri', 'thu6': 'fri', 'thứ6': 'fri',
    't7': 'sat', 'sat': 'sat', 'saturday': 'sat', 'thu7': 'sat', 'thứ7': 'sat',
    'cn': 'sun', 'sun': 'sun', 'sunday': 'sun', 'chunhat': 'sun', 'chủnhật': 'sun'
};

/**
 * Parse day, time, note từ args
 * VD: ['t2', '21h', 'Đánh', 'guild', 'XXX'] → { day: 'mon', time: '21:00', note: 'Đánh guild XXX' }
 * VD: ['t7'] → { day: 'sat', time: null, note: null }
 * VD: [] → null
 */
function parseDayArg(args) {
    if (!args || args.length === 0) return null;

    // Tìm day ở vị trí đầu tiên
    const firstArg = args[0]?.toLowerCase();
    const day = DAY_ALIASES[firstArg];
    if (!day) return null;

    // Parse time (format: 21h, 21h30, 19:30, 20h00)
    let time = null;
    let noteStartIdx = 1;
    if (args[1]) {
        const timeMatch = args[1].match(/^(\d{1,2})[h:](\d{0,2})$/i);
        if (timeMatch) {
            const h = timeMatch[1].padStart(2, '0');
            const m = (timeMatch[2] || '00').padStart(2, '0');
            time = `${h}:${m}`;
            noteStartIdx = 2;
        }
    }

    // Phần còn lại là ghi chú
    const note = args.slice(noteStartIdx).join(' ').trim() || null;

    return { day, time, note };
}

// Helper: Lấy day từ party key (format: guildId_day_leaderId)
function getDayFromPartyKey(partyKey) {
    const parts = partyKey.split('_');
    if (parts.length >= 3) {
        const day = parts[1];
        if (DAY_CONFIG[day]) return day;
    }
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
        const newEmbed = createOverviewEmbed(guildId, client.guilds.cache.get(guildId));
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

/**
 * Kiểm tra session BC đã hết hạn chưa (đã qua 23:00 VN ngày BC)
 * @param {Object} session - Session từ DB (có created_at và day)
 * @returns {boolean} true nếu hết hạn
 */
function isSessionExpired(session) {
    if (!session || !session.created_at) return false;

    const day = session.day;
    if (!day || !DAY_CONFIG[day]) return false;

    // ═══ Tất cả ngày: tính theo 23:00 VN ngày BC ═══
    const vnOffset = 7 * 60; // phút
    const localOffset = new Date().getTimezoneOffset();
    const now = new Date();

    // Lấy ngày tạo session
    const createdAt = new Date(session.created_at);

    // Tìm ngày T7/CN tính từ ngày tạo session
    const targetDayOfWeek = DAY_NUM[day] ?? 0; // Dùng DAY_NUM map cho tất cả ngày

    // Convert createdAt sang VN timezone
    const vnCreated = new Date(createdAt.getTime() + (vnOffset + localOffset) * 60 * 1000);
    const createdDayOfWeek = vnCreated.getDay();

    let daysUntilTarget = targetDayOfWeek - createdDayOfWeek;
    if (daysUntilTarget < 0) daysUntilTarget += 7;

    // Ngày BC target (VN timezone)
    const bcDate = new Date(vnCreated);
    bcDate.setDate(vnCreated.getDate() + daysUntilTarget);
    bcDate.setHours(23, 0, 0, 0);

    // Convert thời điểm 23:00 VN sang UTC để so sánh
    const bcDeadlineUTC = new Date(bcDate.getTime() - (vnOffset + localOffset) * 60 * 1000);

    return now > bcDeadlineUTC;
}

/**
 * Tự động dọn dẹp session BC hết hạn (logic giống ?bcend + auto-end 23:00)
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 * @returns {number} Số session đã cleanup
 */
async function autoCleanupExpiredSessions(client, guildId) {
    const db = require('../database/db');

    const activeSessions = db.getActiveBangchienByGuild(guildId);
    if (activeSessions.length === 0) return 0;

    let cleanedCount = 0;

    for (const session of activeSessions) {
        if (!isSessionExpired(session)) continue;

        const partyKey = session.party_key;
        const sessionDay = session.day || 'sat';

        console.log(`[bangchien] Auto-cleanup session hết hạn: ${partyKey} (${sessionDay})`);

        try {
            const guild = client.guilds.cache.get(guildId);

            // 1. AUTO-SAVE PRESET Team Thủ/Rừng
            const teamDefense = session.team_defense || [];
            const teamForest = session.team_forest || [];

            if (teamDefense.length > 0) {
                const currentPreset = db.getBcPreset(guildId, 'thu', sessionDay);
                const newPreset = [...currentPreset];
                for (const p of teamDefense) {
                    if (!newPreset.some(m => m.id === p.id)) {
                        newPreset.push({ id: p.id, username: p.username });
                    }
                }
                db.setBcPreset(guildId, 'thu', newPreset, sessionDay);
            }

            if (teamForest.length > 0) {
                const currentPreset = db.getBcPreset(guildId, 'rung', sessionDay);
                const newPreset = [...currentPreset];
                for (const p of teamForest) {
                    if (!newPreset.some(m => m.id === p.id)) {
                        newPreset.push({ id: p.id, username: p.username });
                    }
                }
                db.setBcPreset(guildId, 'rung', newPreset, sessionDay);
            }

            // 2. XÓA ROLE BC cho participants
            if (guild) {
                const participants = [
                    ...(session.team_attack1 || []),
                    ...(session.team_attack2 || []),
                    ...(session.team_defense || []),
                    ...(session.team_forest || [])
                ];

                const bcRole = guild.roles.cache.find(r => r.name === 'bc');
                if (bcRole && participants.length > 0) {
                    for (const p of participants) {
                        try {
                            const member = await guild.members.fetch({ user: p.id, force: true }).catch(() => null);
                            if (member && member.roles.cache.has(bcRole.id)) {
                                await member.roles.remove(bcRole);
                            }
                        } catch (e) { }
                    }
                }
            }

            // 3. XÓA MEMORY DATA
            const notifData = bangchienNotifications.get(partyKey);
            if (notifData) {
                if (notifData.intervalId) clearInterval(notifData.intervalId);
                try { if (notifData.message) await notifData.message.delete(); } catch (e) { }
            }
            bangchienNotifications.delete(partyKey);
            bangchienRegistrations.delete(partyKey);

            // Xóa finalized parties liên quan
            for (const [msgId, data] of bangchienFinalizedParties.entries()) {
                if (data.guildId === guildId && data.leaderId === session.leader_id) {
                    bangchienFinalizedParties.delete(msgId);
                }
            }

            // 4. XÓA SESSION KHỎI DB
            db.deleteActiveBangchien(partyKey);

            // 5. SYNC XÓA TRÊN SUPABASE → web realtime DELETE
            try {
                const { deleteBCSession } = require('./supabaseSync');
                await deleteBCSession(guildId, sessionDay);
            } catch (e) { /* bỏ qua nếu supabase chưa init */ }

            cleanedCount++;
            console.log(`[bangchien] Auto-cleanup xong: ${partyKey} (${sessionDay})`);

        } catch (e) {
            console.error(`[bangchien] Lỗi auto-cleanup ${partyKey}:`, e.message);
        }
    }

    // Cập nhật channels nếu hết session
    if (cleanedCount > 0) {
        const remainingKeys = getGuildBangchienKeys(guildId);
        if (remainingKeys.length === 0) {
            bangchienChannels.delete(guildId);
        }

        // Cập nhật overview embed
        await refreshOverviewEmbed(client, guildId);

        console.log(`[bangchien] Auto-cleanup hoàn tất: ${cleanedCount} session hết hạn đã xóa (guild ${guildId})`);
    }

    return cleanedCount;
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
    DAY_NUM,
    PRIMARY_DAYS,
    // Helper functions
    parseDayArg,
    getDayFromPartyKey,
    createPartyKey,
    getGuildBangchienKeys,
    getUserBangchienParty,
    getNextDayDate,
    getDayNameWithDate,
    refreshOverviewEmbed,
    // Auto-cleanup
    isSessionExpired,
    autoCleanupExpiredSessions
};
