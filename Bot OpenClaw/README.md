# Bot OpenClaw

Bot Discord riêng chạy trên cùng máy với OpenClaw. Bot chỉ chuyển tiếp tin nhắn tới OpenClaw Gateway qua loopback và không trực tiếp chạy PowerShell hay shell.

## Lệnh Discord

- `> openclaw`: chọn text channel hiện tại và tạo phiên mới nếu đổi kênh.
- `> openclaw status`: xem kênh, Gateway và hàng đợi.
- `> openclaw reset`: ngắt hàng đợi hiện tại và tạo phiên hội thoại mới.
- `> openclaw stop`: ngắt chờ và xóa hàng đợi; tool đã bắt đầu phía OpenClaw có thể vẫn hoàn tất.
- `> openclaw off`: tắt tương tác và bỏ chọn kênh.

Sau khi chọn kênh, mọi tin nhắn của Discord User ID nằm trong `DISCORD_ALLOWED_USER_IDS` sẽ được chuyển tới OpenClaw. Bot bỏ qua DM, bot khác, webhook, server khác và người dùng không được phép.

## Cấu hình

Sao chép `.env.example` thành `.env` và điền hai token. `OPENCLAW_BASE_URL` bị giới hạn cứng ở HTTP loopback để tránh vô tình công khai quyền điều khiển máy tính.

OpenClaw cần bật Chat Completions API:

```powershell
& "$env:APPDATA\npm\openclaw.cmd" config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
& "$env:APPDATA\npm\openclaw.cmd" config validate
& "$env:APPDATA\npm\openclaw.cmd" gateway restart
```

Bot dùng một session riêng cho mỗi lần chọn/reset kênh. Yêu cầu được xử lý tuần tự và không tự retry, vì retry có thể lặp lại thao tác điều khiển PC.

## Discord Developer Portal

Bật **Message Content Intent** trong trang **Bot** của ứng dụng Discord. Bot chỉ cần các quyền:

- View Channel
- Send Messages
- Read Message History
- Embed Links
- Attach Files

Tổng permission integer cho text channel thông thường là `117760`. Sau khi kiểm tra xong, nên bỏ quyền Administrator hiện tại của bot.

Nên dùng một channel riêng tư. Bot sẽ cảnh báo nếu `@everyone` có thể xem channel được chọn, vì phản hồi OpenClaw có thể chứa dữ liệu nhạy cảm.

## Chạy và kiểm thử

```powershell
npm install
npm test
npm start
```

Cài hoặc gỡ tự khởi động cùng Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-task.ps1
```

Task chạy khi đăng nhập và có watchdog mỗi phút. Nếu tiến trình bot bị dừng, Task Scheduler sẽ tự khởi động lại ở nhịp tiếp theo.

Log nằm tại `logs/bot.log`; trạng thái kênh và session nằm tại `data/state.json`. Các thư mục này cùng `.env` đều bị Git bỏ qua.

## Giới hạn ảnh

- JPEG, PNG hoặc WebP.
- Tối đa 4 ảnh mỗi tin nhắn.
- Tối đa 4 MB mỗi ảnh và 12 MB tổng.
- Bot tải ảnh từ Discord CDN rồi gửi data URL tới OpenClaw; không bật tải URL tùy ý ở Gateway.
