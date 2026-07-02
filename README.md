# Bot Discord Lang Gia

## Voice relay 3 bot

Cấu trúc đúng:

- Bot 1 (Đại Ngỗng): project root này, chạy qua `index.js` -> `src/bot.js`.
- Bot 2 (Tiểu Ngỗng): thư mục `Bot 2 - Tiểu Ngỗng/`.
- Bot 3 (Chiến Ngỗng): thư mục `Bot 3 - Chiến Ngỗng/`.
- Không dùng thư mục `voice-relay/`.

Voice relay mặc định đang tắt để không ảnh hưởng bot cũ. Muốn bật, copy `.env.example` thành `.env` ở root, copy `.env.example` trong folder Bot 2/Bot 3 thành `.env`, rồi đặt:

```env
VOICE_RELAY_ENABLED=true
VOICE_RELAY_LINK_SECRET=chuoi-bi-mat-giong-nhau-o-3-bot
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

Khuyến nghị:

- Bot 1: `VOICE_RELAY_LINK_MODE=server`, mở `VOICE_RELAY_LINK_PORT=8790`.
- Bot 2/Bot 3: `VOICE_RELAY_LINK_MODE=client`, trỏ `VOICE_RELAY_LINK_URL=ws://HOST_BOT_1:8790`.
- Bot 1 dùng lệnh `?relay join/start/stop/status/leave` hoặc `?vr ...`.
- Bot 2 dùng lệnh `!relay join/start/stop/status/leave`.
- Bot 3 dùng lệnh `#relay join/start/stop/status/leave`.

Lưu ý quan trọng: Bot 1 đã có TTS ở `?join`, `?leave`, `?stop` và Loto ở `?loto`, `?lt`, `?lotobo`, ... nên voice relay không dùng trực tiếp các commandName này.

Supabase schema nền nằm ở `db/voice_relay_schema.sql`. Khi nâng cấp 3 bot/setup nhanh, chạy thêm `db/voice_relay_3bot.sql` trong Supabase SQL Editor. Trang cấu hình web là `WebBangChien/voice-editor.html`, API ghi cấu hình là `api/voice-config.js`.

Lưu ý bảo mật: nếu token Bot 3 từng bị dán ra chat/log, hãy reset token trong Discord Developer Portal rồi chỉ đặt token mới trong `.env` hoặc biến môi trường host.
