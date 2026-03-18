const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const WEEKEND_PREF_FILE = path.join(DATA_DIR, 'weekend_yentiec_preference.json');
const SCHEDULE_MESSAGES_FILE = path.join(DATA_DIR, 'schedule_messages.json');
const ACTIVE_EVENTS_FILE = path.join(DATA_DIR, 'active_event_messages.json');
const VOICE_STATE_FILE = path.join(DATA_DIR, 'voice_state.json');

// Đảm bảo thư mục data tồn tại
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Lưu tất cả notifications vào file
function saveNotifications(notificationsMap) {
    try {
        ensureDataDir();

        // Convert Map to array of objects
        const notificationsArray = [];
        for (const [id, notification] of notificationsMap) {
            // Lưu dữ liệu, bỏ qua các timeout/interval IDs (không serialize được)
            notificationsArray.push({
                id,
                userId: notification.userId,
                channelId: notification.channelId,
                guildId: notification.guildId,
                title: notification.title,
                message: notification.message,
                imageUrl: notification.imageUrl || null,
                hours: notification.hours,
                minutes: notification.minutes,
                thu: notification.thu || null,
                isOneTime: notification.isOneTime || false,
                isGuildMission: notification.isGuildMission || false,
                isDaily: notification.isDaily || false,
                missionType: notification.missionType || null,
                day: notification.day || null,
                month: notification.month || null,
                year: notification.year || null,
                nextOccurrence: notification.nextOccurrence ? notification.nextOccurrence.getTime() : null
            });
        }

        fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notificationsArray, null, 2), 'utf8');
        console.log(`✅ Đã lưu ${notificationsArray.length} thông báo vào file`);
        return true;
    } catch (error) {
        console.error('❌ Lỗi khi lưu notifications:', error);
        return false;
    }
}

// Load notifications từ file
function loadNotifications() {
    try {
        if (!fs.existsSync(NOTIFICATIONS_FILE)) {
            console.log('📁 Chưa có file notifications.json, tạo mới');
            return [];
        }

        const data = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
        const notificationsArray = JSON.parse(data);

        // Convert dates back
        notificationsArray.forEach(notification => {
            if (notification.nextOccurrence) {
                notification.nextOccurrence = new Date(notification.nextOccurrence);
            }
        });

        console.log(`✅ Đã load ${notificationsArray.length} thông báo từ file`);
        return notificationsArray;
    } catch (error) {
        console.error('❌ Lỗi khi load notifications:', error);
        return [];
    }
}

// === WEEKEND YẾN TIỆC PREFERENCE ===
// Lưu giờ yến tiệc cuối tuần (19h, 21h hoặc 22h30)
function saveWeekendPreference(guildId, hours, minutes = 0, skipWeekday = false) {
    try {
        ensureDataDir();
        let prefs = {};
        if (fs.existsSync(WEEKEND_PREF_FILE)) {
            prefs = JSON.parse(fs.readFileSync(WEEKEND_PREF_FILE, 'utf8'));
        }
        prefs[guildId] = { hours, minutes, skipWeekday };
        fs.writeFileSync(WEEKEND_PREF_FILE, JSON.stringify(prefs, null, 2), 'utf8');
        console.log(`[storage] Saved weekend preference for guild ${guildId}: ${hours}h${minutes > 0 ? minutes : ''}${skipWeekday ? ' (skip weekday)' : ''}`);
        return true;
    } catch (error) {
        console.error('[storage] Error saving weekend preference:', error);
        return false;
    }
}

// Load giờ yến tiệc cuối tuần (trả về { hours, minutes } hoặc null nếu chưa có)
function loadWeekendPreference(guildId) {
    try {
        if (!fs.existsSync(WEEKEND_PREF_FILE)) {
            return null;
        }
        const prefs = JSON.parse(fs.readFileSync(WEEKEND_PREF_FILE, 'utf8'));
        return prefs[guildId] || null;
    } catch (error) {
        console.error('[storage] Error loading weekend preference:', error);
        return null;
    }
}

// === SCHEDULE MESSAGES PERSISTENCE ===
// Lưu message IDs của lịch tuần để bot restart vẫn tìm lại được
function saveScheduleMessages(scheduleMap) {
    try {
        ensureDataDir();
        const data = {};
        for (const [key, msg] of scheduleMap) {
            // Chỉ lưu messageId và channelId (không lưu object)
            data[key] = {
                messageId: msg.id || msg.messageId,
                channelId: key.split('_')[1]
            };
        }
        fs.writeFileSync(SCHEDULE_MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('[storage] Error saving schedule messages:', error);
        return false;
    }
}

function loadScheduleMessages() {
    try {
        if (!fs.existsSync(SCHEDULE_MESSAGES_FILE)) {
            return {};
        }
        return JSON.parse(fs.readFileSync(SCHEDULE_MESSAGES_FILE, 'utf8'));
    } catch (error) {
        console.error('[storage] Error loading schedule messages:', error);
        return {};
    }
}

// === ACTIVE EVENT MESSAGES ===
// Lưu message ID của tin nhắn event đang diễn ra để khi restart có thể edit thay vì gửi mới
function saveActiveEventMessage(notificationId, channelId, messageId) {
    try {
        ensureDataDir();
        let data = {};
        if (fs.existsSync(ACTIVE_EVENTS_FILE)) {
            data = JSON.parse(fs.readFileSync(ACTIVE_EVENTS_FILE, 'utf8'));
        }
        data[notificationId] = { channelId, messageId, savedAt: Date.now() };
        fs.writeFileSync(ACTIVE_EVENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('[storage] Error saving active event message:', error);
        return false;
    }
}

function removeActiveEventMessage(notificationId) {
    try {
        if (!fs.existsSync(ACTIVE_EVENTS_FILE)) return false;
        const data = JSON.parse(fs.readFileSync(ACTIVE_EVENTS_FILE, 'utf8'));
        delete data[notificationId];
        fs.writeFileSync(ACTIVE_EVENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('[storage] Error removing active event message:', error);
        return false;
    }
}

function loadActiveEventMessages() {
    try {
        if (!fs.existsSync(ACTIVE_EVENTS_FILE)) return {};
        return JSON.parse(fs.readFileSync(ACTIVE_EVENTS_FILE, 'utf8'));
    } catch (error) {
        console.error('[storage] Error loading active event messages:', error);
        return {};
    }
}

// === VOICE STATE PERSISTENCE ===
// Lưu voice channel ID để bot restart có thể kết nối lại
function saveVoiceState(guildId, channelId) {
    try {
        ensureDataDir();
        let data = {};
        if (fs.existsSync(VOICE_STATE_FILE)) {
            data = JSON.parse(fs.readFileSync(VOICE_STATE_FILE, 'utf8'));
        }
        data[guildId] = { channelId, savedAt: Date.now() };
        fs.writeFileSync(VOICE_STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[storage] Đã lưu voice state: guild=${guildId}, channel=${channelId}`);
        return true;
    } catch (error) {
        console.error('[storage] Lỗi lưu voice state:', error);
        return false;
    }
}

function removeVoiceState(guildId) {
    try {
        if (!fs.existsSync(VOICE_STATE_FILE)) return false;
        const data = JSON.parse(fs.readFileSync(VOICE_STATE_FILE, 'utf8'));
        delete data[guildId];
        fs.writeFileSync(VOICE_STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[storage] Đã xóa voice state: guild=${guildId}`);
        return true;
    } catch (error) {
        console.error('[storage] Lỗi xóa voice state:', error);
        return false;
    }
}

function loadVoiceState() {
    try {
        if (!fs.existsSync(VOICE_STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(VOICE_STATE_FILE, 'utf8'));
    } catch (error) {
        console.error('[storage] Lỗi load voice state:', error);
        return {};
    }
}

module.exports = {
    saveNotifications,
    loadNotifications,
    ensureDataDir,
    saveWeekendPreference,
    loadWeekendPreference,
    saveConfirmationDate,
    loadConfirmationDate,
    saveScheduleMessages,
    loadScheduleMessages,
    saveActiveEventMessage,
    removeActiveEventMessage,
    loadActiveEventMessages,
    saveVoiceState,
    removeVoiceState,
    loadVoiceState
};

// === CONFIRMATION DATE TRACKING ===
// Lưu ngày đã xác nhận để tránh hỏi lại khi bot restart
const CONFIRM_DATE_FILE = path.join(DATA_DIR, 'yentiec_confirm_date.json');

function saveConfirmationDate(guildId, type) {
    try {
        ensureDataDir();
        let data = {};
        if (fs.existsSync(CONFIRM_DATE_FILE)) {
            data = JSON.parse(fs.readFileSync(CONFIRM_DATE_FILE, 'utf8'));
        }
        // Lưu theo format YYYY-MM-DD (Vietnam timezone UTC+7)
        const now = new Date();
        const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000); // Shift to VN Time (UTC+7)
        const dateStr = vnNow.toISOString().split('T')[0];
        if (!data[guildId]) data[guildId] = {};
        data[guildId][type] = dateStr;
        fs.writeFileSync(CONFIRM_DATE_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[storage] Saved ${type} confirmation date for guild ${guildId}: ${dateStr}`);
        return true;
    } catch (error) {
        console.error('[storage] Error saving confirmation date:', error);
        return false;
    }
}

function loadConfirmationDate(guildId, type) {
    try {
        if (!fs.existsSync(CONFIRM_DATE_FILE)) {
            return null;
        }
        const data = JSON.parse(fs.readFileSync(CONFIRM_DATE_FILE, 'utf8'));
        return data[guildId]?.[type] || null;
    } catch (error) {
        console.error('[storage] Error loading confirmation date:', error);
        return null;
    }
}


