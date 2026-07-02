# Bot 3 - Chiến Ngỗng

Bot 3 chạy riêng với token riêng và dùng chung module `src/voiceRelay` ở project root.

## Cấu hình

1. Reset token Bot 3 trong Discord Developer Portal nếu token đã từng bị dán ra chat.
2. Copy `.env.example` thành `.env`.
3. Điền `BOT3_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `VOICE_RELAY_LINK_SECRET`.
4. Đặt `VOICE_RELAY_ENABLED=true` khi muốn bật relay.
5. `VOICE_RELAY_LINK_URL` phải trỏ tới host Bot 1, ví dụ `ws://prem-eu2.bot-hosting.net:20637`.

## Chạy

```bash
node index.js
```
