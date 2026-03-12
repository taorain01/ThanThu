/**
 * Gieo Que Daily Reset Scheduler
 * Tự động xóa dữ liệu gieo quẻ & cầu duyên vào lúc 00:00 mỗi ngày (giờ VN UTC+7)
 */

const db = require('../database/db');

let lastResetDate = null;

/**
 * Lấy ngày hiện tại theo múi giờ VN (UTC+7)
 * @returns {string} YYYY-MM-DD
 */
function getTodayVN() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vnTime.toISOString().split('T')[0];
}

/**
 * Kiểm tra và thực hiện reset nếu sang ngày mới
 */
function checkAndReset() {
    const today = getTodayVN();

    // Nếu chưa reset ngày hôm nay
    if (lastResetDate !== today) {
        console.log(`[GieoQueScheduler] 🔄 Sang ngày mới (${today}), đang reset dữ liệu gieo quẻ & cầu duyên...`);

        try {
            const result = db.resetAllDailyUsage();
            lastResetDate = today;
            console.log(`[GieoQueScheduler] ✅ Đã reset thành công! (Xóa ${result.deleted} bản ghi)`);
        } catch (error) {
            console.error('[GieoQueScheduler] ❌ Lỗi khi reset:', error.message);
        }
    }
}

/**
 * Khởi động scheduler
 * Kiểm tra mỗi 30 giây để đảm bảo không bỏ lỡ thời điểm reset
 */
function initGieoQueScheduler() {
    // Set ngày hiện tại để không reset ngay khi bot khởi động
    lastResetDate = getTodayVN();
    console.log(`[GieoQueScheduler] 📅 Khởi động scheduler, ngày hiện tại: ${lastResetDate}`);

    // Kiểm tra mỗi 30 giây
    setInterval(checkAndReset, 30 * 1000);

    console.log('[GieoQueScheduler] ⏰ Đã lên lịch reset gieo quẻ & cầu duyên vào 00:00 hàng ngày (giờ VN)');
}

module.exports = { initGieoQueScheduler };
