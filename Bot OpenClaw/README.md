# Bot OpenClaw

Bot Discord riêng chạy trên cùng máy với OpenClaw. Bot chỉ chuyển tiếp tin nhắn tới OpenClaw Gateway qua loopback và không trực tiếp chạy PowerShell hay shell.

## Lệnh Discord

- `> openclaw`: bật OpenClaw cho text channel hiện tại; mỗi channel có phiên riêng.
- `> openclaw status`: xem job hiện tại, thời gian chạy, bước gần nhất, số file đã gửi/chờ gửi và queue toàn cục.
- `> openclaw jobs`: liệt kê 10 job gần nhất cùng ID và trạng thái.
- `> openclaw resend [job-id] [all|số]`: gửi các file chưa delivery hoặc chủ động gửi lại một file đã delivery.
- `> openclaw resume [job-id]`: khôi phục an toàn job đã dừng, thất bại hoặc hoàn tất có blocker.
- `> openclaw reset`: ngắt hàng đợi và tạo phiên mới chỉ cho channel hiện tại.
- `> openclaw stop [job-id|all]`: abort request cha, gọi `openclaw tasks cancel` và giữ khóa điều khiển cho tới khi task dừng hoặc hết cửa sổ xác nhận 2 phút.
- `> openclaw off`: tắt tương tác chỉ trong channel hiện tại.

Sau khi bật một kênh, mọi tin nhắn của Discord User ID nằm trong `DISCORD_ALLOWED_USER_IDS` ở kênh đó sẽ được chuyển tới OpenClaw. Có thể bật nhiều text channel cùng lúc và mỗi channel vẫn giữ session generation riêng, nhưng mọi yêu cầu điều khiển PC dùng chung một queue toàn cục để không có hai worker cùng giành Chrome, chuột hoặc bàn phím. Bot bỏ qua DM, bot khác, webhook, server khác và người dùng không được phép.

Bot nhận prompt bằng chữ, tối đa 4 ảnh JPEG/PNG/WebP (4 MB mỗi ảnh, 12 MB tổng) và tối đa 2 file âm thanh MP3/M4A/OGG/Opus/WAV/WebM/FLAC/AAC (20 MB mỗi file, 40 MB tổng). Audio được tải từ Discord CDN vào thư mục tạm, phiên âm bằng pipeline STT chính thức của OpenClaw rồi xóa ngay; transcript được ghép vào prompt cùng nội dung chữ và ảnh. File không có MIME vẫn được nhận diện bằng phần mở rộng nằm trong allowlist.

Mỗi lượt OpenClaw dùng idle timeout mặc định 30 phút và thời lượng tối đa 12 giờ. Mọi hoạt động transcript mới sẽ reset idle timer. Request Chat Completions kết thúc hoặc lỗi không làm mất durable task/sub-agent đang chạy; job tiếp tục giữ queue toàn cục và theo dõi nền cho tới khi toàn bộ cây task kết thúc.

Trong lúc OpenClaw làm việc, bot cập nhật một status message và heartbeat mỗi 60 giây. Bot theo dõi transcript của phiên cha cùng mọi session con, kể cả assistant text có `stopReason: toolUse`. Chỉ dòng rõ ràng `MEDIA:<đường dẫn tuyệt đối>` mới được xem là thành phẩm; tham số của tool `image` và screenshot kiểm tra nội bộ không bao giờ tự gửi. Mỗi file hợp lệ được gửi ngay khi xuất hiện, không chờ đủ cả lô.

Trạng thái job, transcript offset, durable task và delivery ledger được lưu nguyên tử tại `data/jobs.json`. Khi bot khởi động lại, task còn chạy được reattach; task đã xong được quét nốt artifact chưa gửi; task bị mất chỉ được tự khôi phục một lần sau prompt xác minh UI. Nếu không chắc chắn, job kết thúc có blocker thay vì gửi lại prompt mù quáng.

## Cấu hình

Sao chép `.env.example` thành `.env` và điền hai token. `OPENCLAW_BASE_URL` bị giới hạn cứng ở HTTP loopback để tránh vô tình công khai quyền điều khiển máy tính. `OPENCLAW_MEDIA_SOURCE_ROOTS` là danh sách thư mục tuyệt đối phân tách bằng dấu `;`; không cho phép dùng trực tiếp gốc ổ đĩa.

OpenClaw cần bật Chat Completions API:

```powershell
& "$env:APPDATA\npm\openclaw.cmd" config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
& "$env:APPDATA\npm\openclaw.cmd" config validate
& "$env:APPDATA\npm\openclaw.cmd" gateway restart
```

Bot dùng một session riêng cho từng channel và từng lần reset. Mọi yêu cầu thao tác OpenClaw được xử lý tuần tự trên queue toàn cục. `OPENCLAW_MAX_PENDING` là tổng số yêu cầu đang chờ trên toàn bot. Các lệnh `status`, `jobs`, `stop`, `resume` và `resend` được xử lý ngay, không phải đợi queue tác vụ PC.

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

Cài hoặc gỡ Scheduled Task chạy nền theo chế độ thủ công:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-task.ps1
```

Task không tự chạy khi đăng nhập. Tạo ứng dụng điều khiển trên Desktop bằng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-control-app.ps1
```

File `OpenClaw Discord Bot.exe` có giao diện trạng thái và các nút Bật bot, Tắt bot, Làm mới, Mở thư mục log. Bot được chạy nền qua Task Scheduler nên không xuất hiện cửa sổ console; Task Scheduler vẫn chống chạy trùng và tự restart khi tiến trình đang chạy gặp lỗi.

Log nằm tại `logs/bot.log`; trạng thái kênh/session nằm tại `data/state.json`; job bền vững và delivery ledger nằm tại `data/jobs.json`. Thư mục `data`, `logs` cùng `.env` đều bị Git bỏ qua.

## Giới hạn ảnh

- JPEG, PNG hoặc WebP.
- Tối đa 4 ảnh mỗi tin nhắn.
- Tối đa 4 MB mỗi ảnh và 12 MB tổng.
- Bot tải ảnh từ Discord CDN rồi gửi data URL tới OpenClaw; không bật tải URL tùy ý ở Gateway.
- Audio được phiên âm bằng `openclaw infer audio transcribe` qua `node` với danh sách tham số cố định, không dùng shell và không đưa tên file của người dùng vào câu lệnh.
- Ảnh OpenClaw gửi ngược lên Discord phải nằm trong `~/.openclaw/workspace`, `~/.openclaw/media` hoặc một root đã khai báo trong `OPENCLAW_MEDIA_SOURCE_ROOTS`.
- Bot kiểm tra canonical path, symlink, phần mở rộng, chữ ký nội dung ảnh thật và giới hạn 8 MB trước khi nhận artifact.
- Artifact được hash để chống gửi trùng, copy vào `~/.openclaw/media/discord-outbox/<job-id>/` trước khi gửi và giữ mặc định 7 ngày.
- Delivery lỗi được thử lại sau 5 giây, 30 giây và 2 phút; sau đó file vẫn ở trạng thái `ready` để dùng lệnh `resend`.
