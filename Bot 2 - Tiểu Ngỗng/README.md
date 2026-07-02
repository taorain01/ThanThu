# Bot 2 - Tiểu Ngỗng

Bot 2 chạy riêng với token riêng. Ngoài các lệnh test cũ, bot có thể bật voice relay để nối voice với Bot 1 (Đại Ngỗng ở project root).

## Chạy local

1. Copy `.env.example` thành `.env`.
2. Điền `BOT2_TOKEN`.
3. Nếu dùng voice relay, đặt `VOICE_RELAY_ENABLED=true`, `VOICE_RELAY_LINK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
4. Chạy:

```powershell
npm start
```

Nếu chạy từ thư mục gốc repo, dùng:

```powershell
node ".\Bot 2 - Tiểu Ngỗng\index.js"
```

## Lệnh test cũ

- `!ping`: test bot online.
- `!bot2`: xem trạng thái Bot 2.
- `!join [voiceChannelId]`: cho Bot 2 vào voice.
- `!leave`: cho Bot 2 rời voice.

## Lệnh voice relay

- `!relay join [voiceChannelId]`: vào kênh relay.
- `!relay start`: bật relay.
- `!relay stop`: tắt relay.
- `!relay status`: xem trạng thái relay.
- `!relay leave`: rời kênh relay.

Bot cần được invite với quyền `View Channels`, `Send Messages`, `Read Message History`, `Connect`, `Speak`, `Use Voice Activity`. Voice relay cần bật thêm `Server Members Intent` và `Message Content Intent` trong Discord Developer Portal.
