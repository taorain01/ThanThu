/**
 * Loto State Management
 * Quản lý phiên lô tô theo guild: số đã bốc, số còn lại, backup, auto timer, nhà cái
 */

// State theo guild: Map<guildId, LotoSession>
const sessions = new Map();

// Backup cho rollback: Map<guildId, LotoSession>
const backups = new Map();

// Auto timers: Map<guildId, { timeout, messageRef }>
const autoTimers = new Map();

// Loto enabled/disabled state (global) - mặc định BẬT
let lotoEnabled = true;

/**
 * Tạo session mặc định (số 1-90)
 */
function createDefaultSession() {
    const available = new Set();
    for (let i = 1; i <= 90; i++) {
        available.add(i);
    }
    return {
        availableNumbers: available,
        drawnNumbers: [],       // Thứ tự bốc (mảng, giữ thứ tự)
        drawnSet: new Set(),    // Set để tra nhanh
        isActive: true,
        dealerId: null,         // ID nhà cái (người đầu tiên gọi ?lt)
        dealerName: null,       // Username nhà cái
        boardMessageId: null,   // ID embed sàn số
        channelId: null,        // Channel chứa embed sàn
        createdAt: Date.now()
    };
}

/**
 * Lấy hoặc tạo session cho guild
 */
function getSession(guildId) {
    if (!sessions.has(guildId)) {
        sessions.set(guildId, createDefaultSession());
    }
    return sessions.get(guildId);
}

/**
 * Kiểm tra session có tồn tại không
 */
function hasSession(guildId) {
    return sessions.has(guildId);
}

/**
 * Set nhà cái
 */
function setDealer(guildId, userId, username) {
    const session = getSession(guildId);
    if (!session.dealerId) {
        session.dealerId = userId;
        session.dealerName = username;
        return true;
    }
    return false; // Đã có nhà cái rồi
}

/**
 * Kiểm tra có phải nhà cái không
 */
function isDealer(guildId, userId) {
    const session = getSession(guildId);
    return session.dealerId === userId;
}

/**
 * Lấy nhà cái
 */
function getDealer(guildId) {
    if (!sessions.has(guildId)) return null;
    const session = sessions.get(guildId);
    return { id: session.dealerId, name: session.dealerName };
}

/**
 * Set board message info
 */
function setBoardMessage(guildId, messageId, channelId) {
    const session = getSession(guildId);
    session.boardMessageId = messageId;
    session.channelId = channelId;
}

/**
 * Bốc 1 số ngẫu nhiên từ sàn
 */
function drawNumber(guildId) {
    const session = getSession(guildId);
    if (session.availableNumbers.size === 0) return null;

    const available = Array.from(session.availableNumbers);
    const index = Math.floor(Math.random() * available.length);
    const number = available[index];

    session.availableNumbers.delete(number);
    session.drawnNumbers.push(number);
    session.drawnSet.add(number);

    return number;
}

/**
 * Kiểm tra số đã bốc chưa
 */
function isDrawn(guildId, number) {
    if (!sessions.has(guildId)) return false;
    return sessions.get(guildId).drawnSet.has(number);
}

/**
 * Thêm số vào sàn
 */
function addNumbers(guildId, numbers) {
    const session = getSession(guildId);
    const added = [];
    const skipped = [];

    for (const num of numbers) {
        if (session.drawnSet.has(num)) {
            skipped.push(num);
        } else if (session.availableNumbers.has(num)) {
            skipped.push(num);
        } else {
            session.availableNumbers.add(num);
            added.push(num);
        }
    }

    return { added, skipped };
}

/**
 * Hoàn tác số vừa bốc (dùng cho trường hợp KINH huỷ animation)
 */
function undoLastDraw(guildId) {
    const session = getSession(guildId);
    if (session.drawnNumbers.length === 0) return null;

    const number = session.drawnNumbers.pop();
    session.drawnSet.delete(number);
    session.availableNumbers.add(number);

    return number;
}

/**
 * Bỏ số khỏi sàn
 */
function removeNumbers(guildId, numbers) {
    const session = getSession(guildId);
    const removed = [];
    const notFound = [];

    for (const num of numbers) {
        if (session.availableNumbers.has(num)) {
            session.availableNumbers.delete(num);
            removed.push(num);
        } else {
            notFound.push(num);
        }
    }

    return { removed, notFound };
}

/**
 * Kết thúc ván - lưu backup và reset
 */
function endSession(guildId) {
    if (!sessions.has(guildId)) return null;

    const oldSession = sessions.get(guildId);

    // Lưu backup cho rollback
    backups.set(guildId, {
        availableNumbers: new Set(oldSession.availableNumbers),
        drawnNumbers: [...oldSession.drawnNumbers],
        drawnSet: new Set(oldSession.drawnSet),
        isActive: oldSession.isActive,
        dealerId: oldSession.dealerId,
        dealerName: oldSession.dealerName,
        boardMessageId: oldSession.boardMessageId,
        channelId: oldSession.channelId,
        createdAt: oldSession.createdAt
    });

    // Dừng auto nếu đang chạy
    stopAuto(guildId);

    // Reset session (xóa luôn nhà cái)
    sessions.delete(guildId);

    return oldSession;
}

/**
 * Rollback về trước khi end
 */
function rollback(guildId) {
    if (!backups.has(guildId)) return false;

    const backup = backups.get(guildId);
    sessions.set(guildId, backup);
    backups.delete(guildId);

    return true;
}

/**
 * Có backup để rollback không
 */
function hasBackup(guildId) {
    return backups.has(guildId);
}

// ============== AUTO TIMER ==============

/**
 * Bắt đầu auto-draw
 */
function startAuto(guildId, timerData) {
    stopAuto(guildId);
    autoTimers.set(guildId, timerData);
}

/**
 * Dừng auto-draw
 */
function stopAuto(guildId) {
    if (!autoTimers.has(guildId)) return false;

    const timer = autoTimers.get(guildId);
    if (timer.timeout) {
        clearTimeout(timer.timeout);
    }
    autoTimers.delete(guildId);
    return true;
}

/**
 * Kiểm tra đang auto không
 */
function isAutoRunning(guildId) {
    return autoTimers.has(guildId);
}

// ============== ADMIN TOGGLE ==============

/**
 * Bật loto
 */
function enableLoto() {
    lotoEnabled = true;
}

/**
 * Tắt loto
 */
function disableLoto() {
    lotoEnabled = false;
}

/**
 * Kiểm tra loto có đang bật không
 */
function isLotoEnabled() {
    return lotoEnabled;
}

/**
 * Lấy channelId đang có loto active cho guild (có boardMessageId = đang chơi)
 */
function getActiveLotoChannelId(guildId) {
    if (!sessions.has(guildId)) return null;
    const session = sessions.get(guildId);
    if (session.boardMessageId && session.channelId) {
        return session.channelId;
    }
    return null;
}

module.exports = {
    getSession,
    hasSession,
    drawNumber,
    isDrawn,
    addNumbers,
    removeNumbers,
    endSession,
    rollback,
    hasBackup,
    startAuto,
    stopAuto,
    isAutoRunning,
    setDealer,
    isDealer,
    getDealer,
    setBoardMessage,
    enableLoto,
    disableLoto,
    isLotoEnabled,
    getActiveLotoChannelId,
    undoLastDraw
};
