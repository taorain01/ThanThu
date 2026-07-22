/**
 * ============================================================
 *  CÔNG TẮC BẬT/TẮT CÁC CHỨC NĂNG TỰ ĐỘNG CỦA BOT
 * ============================================================
 *
 * File trung tâm để bật/tắt các chức năng chạy tự động.
 *   - true  = BẬT (chạy bình thường)
 *   - false = TẮT (không chạy)
 *
 * Muốn bật lại cái nào thì đổi false -> true rồi restart bot.
 *
 * ⚠️ CÁC CHỨC NĂNG SAU ĐANG GIỮ CHẠY (không nằm trong file này):
 *   - Dịch tự động (translateService)
 *   - TTS auto-read (đọc tin bắt đầu bằng ".")
 *   - Gieo quẻ / Cầu duyên (lệnh + reset hàng ngày + hướng dẫn tự động)
 *   - DM cảm ơn khi Boost server
 *   - Welcome image + DM khi thành viên mới join
 *   - Cộng EXP (text chat + voice)
 *   - Voice Relay (watchdog / auto-reconnect)
 *
 * ------------------------------------------------------------
 * LỊCH SỬ:
 *   2026-07-22: Tắt TikTok converter, Album auto-save, toàn bộ
 *               thông báo theo lịch (Boss/Phòng Ảnh/Yến Tiệc/
 *               báo cáo chiến thuật), auto-chốt Boss, auto-end
 *               Bang Chiến, và thông báo thành viên rời guild.
 * ------------------------------------------------------------
 */

module.exports = {
  // Tự chuyển link TikTok -> tnktok.com (xóa tin gốc, gửi tin mới)
  tiktokConverter: false,

  // Tự lưu ảnh gửi vào Phòng Ảnh lên Cloudinary/ImgBB
  albumAutoSave: false,

  // Gửi lịch Boss Guild tự động hàng tuần (thứ 2 lúc 8h VN)
  weeklyBossSchedule: false,

  // Gửi báo cáo dung lượng lưu chiến thuật hàng tuần (webhook)
  weeklyTacticsReport: false,

  // Gửi hướng dẫn Phòng Ảnh tự động hàng tháng (ngày 1 lúc 8h VN)
  monthlyPhongAnhGuide: false,

  // Nhắc đổi giờ Yến Tiệc (thứ 7 & thứ 2 lúc 12h VN)
  yentiecReminder: false,

  // Tự chốt danh sách Boss Guild sau 1 tiếng
  bossAutoClose: false,

  // Tự kết thúc phiên Bang Chiến theo lịch (23:00 mỗi ngày)
  bangchienAutoEnd: false,

  // Thông báo khi thành viên rời guild (embed vào kênh cố định)
  memberLeaveNotification: false,
};
