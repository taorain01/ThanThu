# Bot OpenClaw

Bot Discord riêng chạy trên cùng máy với OpenClaw. Bot chỉ chuyển tiếp tin nhắn tới OpenClaw Gateway qua loopback và không trực tiếp chạy PowerShell hay shell.

## Lệnh Discord

- `> openclaw`: bật OpenClaw cho text channel hiện tại; mỗi channel có phiên riêng.
- `> openclaw status`: xem trạng thái channel hiện tại, Gateway, hàng đợi và các channel đang bật.
- `> openclaw reset`: ngắt hàng đợi và tạo phiên mới chỉ cho channel hiện tại.
- `> openclaw stop`: ngắt chờ và xóa hàng đợi chỉ trong channel hiện tại; tool đã bắt đầu phía OpenClaw có thể vẫn hoàn tất.
- `> openclaw off`: tắt tương tác chỉ trong channel hiện tại.

Sau khi bật một kênh, mọi tin nhắn của Discord User ID nằm trong `DISCORD_ALLOWED_USER_IDS` ở kênh đó sẽ được chuyển tới OpenClaw. Có thể bật nhiều text channel cùng lúc; mỗi channel giữ session generation và hàng đợi độc lập nên chuyển qua lại không mất hội thoại. Bot bỏ qua DM, bot khác, webhook, server khác và người dùng không được phép.

Trong lúc OpenClaw làm việc, bot cập nhật một bảng tiến độ gồm từng tool bắt đầu/kết thúc. Khi phiên hoàn tất, toàn bộ nhật ký đã lọc được giữ trong chat; token, nội dung file, đường dẫn nhạy cảm và dữ liệu ảnh base64 không được hiển thị. Ảnh trong workspace/media mà OpenClaw dùng hoặc đánh dấu bằng `MEDIA:<đường dẫn>` sẽ được gửi lên Discord dưới dạng attachment.

## Cấu hình

Sao chép `.env.example` thành `.env` và điền hai token. `OPENCLAW_BASE_URL` bị giới hạn cứng ở HTTP loopback để tránh vô tình công khai quyền điều khiển máy tính.

OpenClaw cần bật Chat Completions API:

```powershell
& "$env:APPDATA\npm\openclaw.cmd" config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
& "$env:APPDATA\npm\openclaw.cmd" config validate
& "$env:APPDATA\npm\openclaw.cmd" gateway restart
```

Bot dùng một session riêng cho từng channel và từng lần reset. Yêu cầu trong cùng channel được xử lý tuần tự, còn các channel khác nhau có thể chạy song song. Bot không tự retry vì retry có thể lặp lại thao tác điều khiển PC.

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
- Ảnh OpenClaw gửi ngược lên Discord phải nằm trong `~/.openclaw/workspace` hoặc `~/.openclaw/media` và không vượt quá 8 MB mỗi ảnh.
