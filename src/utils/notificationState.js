// Shared notification state module
// This module holds the shared state to avoid circular dependencies

// Map lưu trữ các thông báo lặp lại
const weeklyNotifications = new Map();

// Mapping thứ trong tuần
const dayNames = {
    2: 'Thứ 2',
    3: 'Thứ 3',
    4: 'Thứ 4',
    5: 'Thứ 5',
    6: 'Thứ 6',
    7: 'Thứ 7',
    8: 'Chủ nhật'
};

// Mẫu thông báo Guild với embed (moved here to avoid circular dependency)
const guildTemplates = {
    BossSolo: {
        title: '⚔️ Breaking Army - Boss Solo',
        eventName: 'Boss Solo',
        questName: 'Breaking Army',
        message: '💪 Hãy đến để hoàn thành nhiệm vụ Guild tuần này!',
        color: 0xFF4444,
        emoji: '⚔️',
        limit: 2,
        duration: 120  // 2 tiếng
    },
    PvpSolo: {
        title: '🏆 Test Your Skill - PvP Solo',
        eventName: 'PvP Solo',
        questName: 'Test Your Skill',
        message: '⚔️ Hãy đến để hoàn thành nhiệm vụ Guild tuần này!',
        color: 0xFFAA00,
        emoji: '🏆',
        limit: 2,
        duration: 60  // 1 tiếng
    },
    YenTiec: {
        title: '🎉 Guild Party - Yến Tiệc',
        eventName: 'Yến Tiệc',
        questName: null,
        message: '🍻 Hãy đến để hoàn thành nhiệm vụ Guild tuần này!',
        color: 0x9B59B6,
        emoji: '🎉',
        limit: 1,
        isDaily: true,
        duration: 15,  // 15 phút
        roleName: 'Yến Tiệc'
    },
    BangChien: {
        title: '🏰 Bang Chiến - 30vs30',
        eventName: 'Bang Chiến',
        questName: '30vs30',
        message: '🏰 Bang Chiến 30vs30 đang diễn ra! Hãy tham gia ngay!',
        color: 0xE74C3C,
        emoji: '🏰',
        limit: 2,
        duration: 150,  // 2 tiếng rưỡi
        roleName: 'bc'
    }
};

// Map quản lý sự kiện đang diễn ra (để gộp overlap)
// Key: `${guildId}_${channelId}`, Value: { messageRef, events: Map<missionType, {startTime, endTime, elapsed, duration, template, intervalId}> }
const activeGuildEvents = new Map();

// Map lưu message ID của lịch tuần đã gửi (để xoá khi gửi mới)
// Key: `${guildId}_${channelId}`, Value: messageRef
const scheduleMessages = new Map();

module.exports = {
    weeklyNotifications,
    dayNames,
    guildTemplates,
    activeGuildEvents,
    scheduleMessages
};
