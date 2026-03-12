// Boss Guild Notification State
// Lưu trữ trạng thái thông báo boss

// Map lưu trữ thông báo boss đang chạy
// Key: `${guildId}_${leaderId}`, Value: { intervalId, channelId, leaderId, messageId, message, startTime }
const bossNotifications = new Map();

// Map lưu danh sách đăng ký
// Key: `${guildId}_${leaderId}`, Value: [{ id, username, joinedAt }]
const bossRegistrations = new Map();

// Giới hạn số party tối đa mỗi guild
const MAX_PARTIES_PER_GUILD = 3;

// Helper: Lấy tất cả party keys của một guild
function getGuildPartyKeys(guildId) {
    const keys = [];
    for (const key of bossNotifications.keys()) {
        if (key.startsWith(`${guildId}_`)) {
            keys.push(key);
        }
    }
    return keys;
}

// Helper: Kiểm tra user đã đăng ký party nào chưa
function getUserRegisteredParty(guildId, userId) {
    for (const [key, registrations] of bossRegistrations) {
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
const finalizedParties = new Map();

// Map lưu timers cho schedule embed (gửi sau 1h không hoạt động)
// Key: channelId, Value: { timeoutId, lastMessageId }
const scheduleTimers = new Map();

// ID kênh boss guild (để biết kênh nào cần theo dõi)
// Key: guildId, Value: channelId
const bossChannels = new Map();

// Map lưu debounce timers cho refresh embed
// Key: partyKey, Value: timeoutId
const bossRefreshTimers = new Map();

// Debounce time (5 phút)
const BOSS_REFRESH_DEBOUNCE = 5 * 60 * 1000;

// Lịch Boss Guild (có thể chỉnh sửa)
// dayOfWeek: 0=CN, 1=T2, 2=T3, 3=T4, 4=T5, 5=T6, 6=T7
const bossSchedule = [
    { dayOfWeek: 1, name: 'Thứ 2', hour: 19, minute: 0 },
    { dayOfWeek: 2, name: 'Thứ 3', hour: 19, minute: 0 },
    { dayOfWeek: 5, name: 'Thứ 6', hour: 19, minute: 0 }
];

// Helper: Cập nhật lịch boss
function updateBossSchedule(dayOfWeek, hour, minute = 0) {
    const dayNames = {
        0: 'Chủ nhật', 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7'
    };

    const existing = bossSchedule.find(s => s.dayOfWeek === dayOfWeek);
    if (existing) {
        existing.hour = hour;
        existing.minute = minute;
        return { updated: true, schedule: existing };
    } else {
        const newSchedule = { dayOfWeek, name: dayNames[dayOfWeek], hour, minute };
        bossSchedule.push(newSchedule);
        return { updated: false, schedule: newSchedule };
    }
}

// Helper: Xóa lịch boss theo ngày
function removeBossSchedule(dayOfWeek) {
    const index = bossSchedule.findIndex(s => s.dayOfWeek === dayOfWeek);
    if (index !== -1) {
        bossSchedule.splice(index, 1);
        return true;
    }
    return false;
}

// Lưu message ID của embed lịch cuối cùng (để xóa trước khi gửi mới)
// Key: channelId, Value: messageId
const lastScheduleEmbed = new Map();

// ============== PRE-REGISTRATION (+1) ==============
// Map lưu danh sách đăng ký trước (+1)
// Key: guildId, Value: [{ id, username, registeredAt }]
const bossPreRegistrations = new Map();

// Channel ID cho phép đăng ký trước
const PRE_REGISTER_CHANNEL_ID = '1453292923880996896';

// Helper: Thêm người vào danh sách đăng ký trước
function addPreRegistration(guildId, userId, username) {
    if (!bossPreRegistrations.has(guildId)) {
        bossPreRegistrations.set(guildId, []);
    }
    const list = bossPreRegistrations.get(guildId);

    // Kiểm tra đã đăng ký chưa
    if (list.some(r => r.id === userId)) {
        return false; // Đã đăng ký rồi
    }

    list.push({
        id: userId,
        username: username,
        registeredAt: Date.now()
    });
    return true;
}

// Helper: Xóa người khỏi danh sách đăng ký trước
function removePreRegistration(guildId, userId) {
    if (!bossPreRegistrations.has(guildId)) {
        return false;
    }
    const list = bossPreRegistrations.get(guildId);
    const index = list.findIndex(r => r.id === userId);
    if (index === -1) {
        return false; // Không có trong danh sách
    }
    list.splice(index, 1);
    return true;
}

// Helper: Lấy danh sách đăng ký trước
function getPreRegistrations(guildId) {
    return bossPreRegistrations.get(guildId) || [];
}

// Helper: Xóa toàn bộ danh sách đăng ký trước
function clearPreRegistrations(guildId) {
    bossPreRegistrations.delete(guildId);
}

// Helper: Kiểm tra user đã đăng ký trước chưa
function isPreRegistered(guildId, userId) {
    const list = bossPreRegistrations.get(guildId) || [];
    return list.some(r => r.id === userId);
}

module.exports = {
    bossNotifications,
    bossRegistrations,
    finalizedParties,
    scheduleTimers,
    bossChannels,
    bossSchedule,
    lastScheduleEmbed,
    bossRefreshTimers,
    BOSS_REFRESH_DEBOUNCE,
    MAX_PARTIES_PER_GUILD,
    getGuildPartyKeys,
    getUserRegisteredParty,
    updateBossSchedule,
    removeBossSchedule,
    // Pre-registration exports
    bossPreRegistrations,
    PRE_REGISTER_CHANNEL_ID,
    addPreRegistration,
    removePreRegistration,
    getPreRegistrations,
    clearPreRegistrations,
    isPreRegistered
};
