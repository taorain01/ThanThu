/**
 * Shared state cho weekly scheduler và messageCreate
 * Lưu trữ message IDs để xóa embed cũ trước khi gửi mới
 */

// Map<channelId, messageId> for last phòng ảnh help message
const lastPhongAnhMessage = new Map();

// Map<channelId, messageId> for last gieo quẻ guide message
const lastGieoQueGuideWeekly = new Map();

// Map<channelId, mondayDateString> - track tuần nào đã gửi guide rồi
const gieoQueGuideSentWeek = new Map();
const phongAnhGuideSentWeek = new Map();

/**
 * Lấy ngày thứ Hai của tuần hiện tại (giờ VN UTC+7)
 * @returns {string} YYYY-MM-DD
 */
function getCurrentWeekMonday() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const day = vnTime.getUTCDay(); // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? 6 : day - 1; // số ngày kể từ thứ Hai
    const monday = new Date(vnTime);
    monday.setUTCDate(vnTime.getUTCDate() - diff);
    return monday.toISOString().split('T')[0];
}

/**
 * Lấy tuần hiện tại dựa trên mốc 8h sáng thứ Hai (giờ VN UTC+7)
 * Trước 8h sáng thứ Hai → vẫn tính là tuần trước
 * @returns {string} YYYY-MM-DD (ngày thứ Hai của tuần đang active)
 */
function getCurrentWeekMonday8AM() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const day = vnTime.getUTCDay(); // 0=Sun, 1=Mon, ...
    const hour = vnTime.getUTCHours();
    const diff = day === 0 ? 6 : day - 1; // số ngày kể từ thứ Hai
    const monday = new Date(vnTime);
    monday.setUTCDate(vnTime.getUTCDate() - diff);

    // Nếu đang là thứ Hai và chưa đến 8h sáng → tuần trước
    if (day === 1 && hour < 8) {
        monday.setUTCDate(monday.getUTCDate() - 7);
    }

    return monday.toISOString().split('T')[0];
}

module.exports = {
    lastPhongAnhMessage,
    lastGieoQueGuideWeekly,
    gieoQueGuideSentWeek,
    phongAnhGuideSentWeek,
    getCurrentWeekMonday,
    getCurrentWeekMonday8AM
};
