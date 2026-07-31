# Bot OpenClaw

Bot Discord riêng chạy trên cùng máy với OpenClaw. Bot chỉ chuyển tiếp tin nhắn tới OpenClaw Gateway qua loopback và không trực tiếp chạy PowerShell hay shell.

## Lệnh Discord

- `> openclaw`: bật OpenClaw cho text channel hiện tại; mỗi channel có phiên riêng.
- `> openclaw status`: xem job hiện tại, thời gian chạy, bước gần nhất, số file đã gửi/chờ gửi và số session đang chạy/chờ.
- `> openclaw jobs`: liệt kê 10 job gần nhất cùng ID và trạng thái.
- `> openclaw model local`: chuyển riêng channel hiện tại sang model Ollama local.
- `> openclaw model 9router`: chuyển riêng channel hiện tại về model qua 9Router.
- `> openclaw resend [job-id] [all|số]`: gửi các file chưa delivery hoặc chủ động gửi lại một file đã delivery.
- `> openclaw resume [job-id]`: khôi phục an toàn job đã dừng, thất bại hoặc hoàn tất có blocker.
- `> openclaw reset`: ngắt hàng đợi và tạo phiên mới chỉ cho channel hiện tại.
- `> openclaw stop [job-id|all]`: abort request cha, gọi `openclaw tasks cancel` và giữ khóa điều khiển cho tới khi task dừng hoặc hết cửa sổ xác nhận 2 phút.
- `> openclaw off`: tắt tương tác chỉ trong channel hiện tại.

Alias ngắn:

- `> o`: tương đương `> openclaw`.
- `> o s [job-id|all]`: tương đương `> openclaw stop [job-id|all]`.
- `> o m [local|9router]`: tương đương `> openclaw model [local|9router]`.

Sau khi bật một kênh, mọi tin nhắn của Discord User ID nằm trong `DISCORD_ALLOWED_USER_IDS` ở kênh đó sẽ được chuyển tới OpenClaw. Có thể bật nhiều text channel cùng lúc và mỗi channel giữ session generation riêng. Scheduler cho phép các session khác nhau chạy song song, còn tin nhắn trong cùng một session luôn chạy tuần tự để không đảo thứ tự hội thoại. Bot bỏ qua DM, bot khác, webhook, server khác và người dùng không được phép.

Bot nhận prompt bằng chữ, tối đa 4 ảnh JPEG/PNG/WebP (4 MB mỗi ảnh, 12 MB tổng) và tối đa 2 file âm thanh MP3/M4A/OGG/Opus/WAV/WebM/FLAC/AAC (20 MB mỗi file, 40 MB tổng). Audio được tải từ Discord CDN vào thư mục tạm, phiên âm bằng pipeline STT chính thức của OpenClaw rồi xóa ngay; transcript được ghép vào prompt cùng nội dung chữ và ảnh. File không có MIME vẫn được nhận diện bằng phần mở rộng nằm trong allowlist.

Mỗi lượt OpenClaw dùng idle timeout mặc định 30 phút và thời lượng tối đa 12 giờ. Mọi hoạt động transcript mới sẽ reset idle timer. Request Chat Completions kết thúc hoặc lỗi không làm mất durable task/sub-agent đang chạy; job tiếp tục giữ lượt của session và theo dõi nền cho tới khi toàn bộ cây task kết thúc.

Trong lúc OpenClaw làm việc, bot cập nhật một status message và heartbeat mỗi 60 giây. Nếu status của job đang chạy bị các tin nhắn mới đẩy lên trên, bot tạo bản cập nhật ở cuối channel rồi xóa bản cũ để tiến độ luôn dễ thấy mà không tích lũy embed. Bot theo dõi transcript của phiên cha cùng mọi session con, kể cả assistant text có `stopReason: toolUse`. Chỉ dòng rõ ràng `MEDIA:<đường dẫn tuyệt đối>` mới được xem là thành phẩm; tham số của tool `image` và screenshot kiểm tra nội bộ không bao giờ tự gửi. Mỗi file hợp lệ được gửi ngay khi xuất hiện, không chờ đủ cả lô.

Trạng thái job, transcript offset, durable task và delivery ledger được lưu nguyên tử tại `data/jobs.json`. Khi bot khởi động lại, task còn chạy được reattach; task đã xong được quét nốt artifact chưa gửi; task bị mất chỉ được tự khôi phục một lần sau prompt xác minh UI. Nếu không chắc chắn, job kết thúc có blocker thay vì gửi lại prompt mù quáng.

## Cấu hình

Sao chép `.env.example` thành `.env` và điền hai token. `OPENCLAW_BASE_URL` bị giới hạn cứng ở HTTP loopback để tránh vô tình công khai quyền điều khiển máy tính. `OPENCLAW_MEDIA_SOURCE_ROOTS` là danh sách thư mục tuyệt đối phân tách bằng dấu `;`; không cho phép dùng trực tiếp gốc ổ đĩa. `OPENCLAW_BACKEND_MODEL_9ROUTER` và `OPENCLAW_BACKEND_MODEL_LOCAL` đặt model thật tương ứng với hai lệnh chuyển model; `OPENCLAW_MODEL` vẫn phải giữ target Gateway như `openclaw/default`. `OPENCLAW_MAX_CONCURRENT_SESSIONS` mặc định là `2`; giảm về `1` nếu nhiều job cùng điều khiển chung một desktop, chuột, bàn phím hoặc cùng một profile trình duyệt.

OpenClaw cần bật Chat Completions API:

```powershell
& "$env:APPDATA\npm\openclaw.cmd" config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
& "$env:APPDATA\npm\openclaw.cmd" config validate
& "$env:APPDATA\npm\openclaw.cmd" gateway restart
```

Bot dùng một session và lựa chọn model riêng cho từng channel. Lệnh đổi model không thay đổi job đang chạy; model mới áp dụng từ yêu cầu tiếp theo và được lưu cùng job để quá trình recovery tiếp tục đúng provider. Tối đa `OPENCLAW_MAX_CONCURRENT_SESSIONS` session khác nhau chạy đồng thời; mỗi session chỉ chạy một yêu cầu tại một thời điểm. `OPENCLAW_MAX_PENDING` là tổng số yêu cầu đang chờ trên toàn bot. Các lệnh `status`, `jobs`, `model`, `stop`, `resume` và `resend` được xử lý ngay, không phải đợi scheduler.

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

Khi task của bot đang chạy, launcher `scripts/run-bot-awake.ps1` tạo yêu cầu giữ **hệ thống** thức nhưng không giữ **màn hình** sáng. Vì vậy Windows vẫn có thể tắt màn hình, còn CPU, mạng, OpenClaw Gateway và bot Discord tiếp tục chạy. Yêu cầu giữ thức được gỡ tự động ngay khi bot dừng.

Không khóa Windows bằng `Win+L` nếu job cần chụp hoặc điều khiển desktop. Nếu nút nguồn của màn hình/DisplayPort làm Windows mất hẳn display, các lệnh `screen.snapshot` vẫn cần một HDMI dummy plug hoặc virtual display; các job chỉ dùng file, API hay browser headless không bị giới hạn này.

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
