# Bot OpenClaw

Bot Discord riêng chạy trên cùng máy với OpenClaw. Bot chỉ chuyển tiếp tin nhắn tới OpenClaw Gateway qua loopback và không trực tiếp chạy PowerShell hay shell.

## Gửi chủ động tới channel Discord

OpenClaw có thể dùng chính bot này để gửi nội dung hoặc file tới bất kỳ text channel/thread nào thuộc server trong `DISCORD_GUILD_ID`. Channel đích được chọn theo tên hoặc ID ở từng lần gửi, không cần khai báo trước:

```powershell
node .\scripts\send-discord-message.js --channel 1533105740145758248 --content "0001 — Make Room for a Beautiful Day" --file "F:\Hình Ảnh\anhYoutube\SeoraChill\0001 - Make Room for a Beautiful Day\(background)\0001 - Make Room for a Beautiful Day (background).png"
node .\scripts\send-discord-message.js --channel output-seorachill --content "0001 — Make Room for a Beautiful Day"
```

Có thể lặp lại `--file`, dùng `--content-file` cho caption UTF-8 dài, hoặc truyền một request JSON bằng `--request`:

```json
{
  "channel": "output-seorachill",
  "content": "0001 — Make Room for a Beautiful Day (Background)",
  "files": [
    "F:\\Hình Ảnh\\anhYoutube\\SeoraChill\\0001 - Make Room for a Beautiful Day\\(background)\\0001 - Make Room for a Beautiful Day (background).png"
  ]
}
```

Bot luôn xác minh channel thuộc đúng server, vô hiệu hóa mention tự động và chỉ nhận file trong OpenClaw workspace/media hoặc `OPENCLAW_MEDIA_SOURCE_ROOTS`. Tên channel được so khớp chính xác nhưng không phân biệt hoa/thường; nếu có tên trùng, sender bắt buộc dùng ID để tránh gửi nhầm. Dùng `--dry-run` để kiểm tra channel, đường dẫn và dung lượng mà chưa gửi thật.

## Chèn logo kênh vào ảnh

Workflow ảnh dùng asset logo thật thay vì yêu cầu model tự vẽ lại. Script giữ nguyên kích thước ảnh, đặt logo giữa mép trên và ghi PNG mới:

```powershell
node "C:\Bot Discord\scripts\apply-channel-logo.js" --input "<master.png>" --logo "<logo.png>" --output "<final.png>" --width-percent 14 --top-percent 2.2
```

Dùng `--dry-run` để kiểm tra vị trí và xem `contrastEstimate` (tương phản logo trắng trên nền thực tế, PASS khi ≥ 3), `--shadow-strength 0.5–5` để chỉnh độ đậm halo khi nền sáng (mặc định 2), `--no-shadow` để tắt halo và `--overwrite` khi chủ động thay file final cũ. Chế độ overwrite giữ bản cũ tạm thời và tự phục hồi nếu bước thay file gặp lỗi.

Lớp tối phía sau logo là **halo mềm bao quanh đều**, không phải drop-shadow lệch hướng: blur tính theo chiều cao logo và không có offset, nên nó chỉ tách logo khỏi nền sáng chứ không đọc ra như vệt bóng đen. Alpha bị chặn trần thấp để ngay ở `--shadow-strength 5` cũng không có pixel nào tối đi quá 60/255 — ngưỡng mà halo bắt đầu trông như khối đen bám dưới chữ.

OpenClaw không cần cài Discord channel native để dùng sender này. Prompt hệ thống của bridge yêu cầu agent dùng script cục bộ thay cho tool `message` khi người dùng chỉ định tên hoặc ID channel. Bot cũng bỏ qua placeholder kỹ thuật `No response from OpenClaw.` và tiếp tục chờ transcript khi durable task vẫn hoàn tất ở nền.

## Lệnh Discord

- `. openclaw`: bật OpenClaw cho text channel hiện tại; mỗi channel có phiên riêng.
- `. openclaw status`: mở dashboard embed gồm Gateway, channel/model/session, scheduler, job, media và cảnh báo quyền.
- `. openclaw jobs`: liệt kê 10 job gần nhất cùng ID và trạng thái.
- `. o upload [status|list|start [item-id...]|stop [run-id]]`: điều khiển đúng hàng đợi YouTube đang mở trong Rainder; nếu Rainder tắt bot chỉ báo offline.
- `. openclaw model local`: chuyển riêng channel hiện tại sang model Ollama local.
- `. openclaw model 9router`: chuyển riêng channel hiện tại về model qua 9Router.
- `. openclaw resend [job-id] [all|số]`: gửi các file chưa delivery hoặc chủ động gửi lại một file đã delivery.
- `. openclaw resume [job-id]`: khôi phục an toàn job đã dừng, thất bại hoặc hoàn tất có blocker.
- `. openclaw reset`: ngắt hàng đợi và tạo phiên mới chỉ cho channel hiện tại.
- `. openclaw stop [job-id|all]`: abort request cha, gọi `openclaw tasks cancel` và giữ khóa điều khiển cho tới khi task dừng hoặc hết cửa sổ xác nhận 2 phút.
- `. openclaw off`: tắt tương tác chỉ trong channel hiện tại.

Alias ngắn:

- `. o` hoặc `. o status`: mở dashboard trạng thái trực tiếp, tương đương `. openclaw status`.
- `. o stop [job-id|all]`: dừng trực tiếp, tương đương `. openclaw stop [job-id|all]`; vẫn hỗ trợ dạng cũ `. o s`.
- `. o m`: mở bảng chọn model **3 cấp** — chọn nhóm (**Claude** / **9router** / **local** / **opus**) trước, bấm vào nhóm Claude để chọn profile app (Tuat, Ying, BBDEV…), bấm vào profile để chọn model (opus/sonnet/haiku + mọi model của backend); nhóm 9router/local/opus hiển thị thẳng mọi model của backend đó (vd local có gemma4:e4b, qwen3.5:27b…). Nút ◀/▶ lật trang khi quá 25 lựa chọn, nút ← quay lại cấp trước.
- `. o m <tên profile | model-id>`: chuyển thẳng theo tên/slug profile app, theo `local|9router` (hoặc model thật của profile cứng), hoặc theo ID model bất kỳ trong danh mục (vd `. o m claude-opus-4-6`, `. o m ollama/qwen3.5:4b`); `. o m refresh` làm mới cache danh mục.

Sau khi bật một kênh, mọi tin nhắn của Discord User ID nằm trong `DISCORD_ALLOWED_USER_IDS` ở kênh đó sẽ được chuyển tới OpenClaw. Có thể bật nhiều text channel cùng lúc và mỗi channel giữ session generation riêng. Scheduler cho phép các session khác nhau chạy song song, còn tin nhắn trong cùng một session luôn chạy tuần tự để không đảo thứ tự hội thoại. Bot bỏ qua DM, bot khác, webhook, server khác và người dùng không được phép.

Bot nhận prompt bằng chữ, tối đa 4 ảnh JPEG/PNG/WebP (4 MB mỗi ảnh, 12 MB tổng) và tối đa 2 file âm thanh MP3/M4A/OGG/Opus/WAV/WebM/FLAC/AAC (20 MB mỗi file, 40 MB tổng). Audio được tải từ Discord CDN vào thư mục tạm, phiên âm bằng pipeline STT chính thức của OpenClaw rồi xóa ngay; transcript được ghép vào prompt cùng nội dung chữ và ảnh. File không có MIME vẫn được nhận diện bằng phần mở rộng nằm trong allowlist.

Mỗi lượt OpenClaw dùng idle timeout mặc định 30 phút và thời lượng tối đa 12 giờ. Mọi hoạt động transcript mới sẽ reset idle timer. Request Chat Completions kết thúc hoặc lỗi không làm mất durable task/sub-agent đang chạy; job tiếp tục giữ lượt của session và theo dõi nền cho tới khi toàn bộ cây task kết thúc.

Trong lúc OpenClaw làm việc, kênh chính chỉ giữ status gọn gồm thời gian, phần trăm context, file, worker, số ảnh gần nhất, task hiện tại, preview ngắn và ba hoạt động mới nhất. Bot đồng thời tạo một thread chi tiết từ tin nhắn yêu cầu gốc; nút **Xem chi tiết** trên status mở thread này để xem context theo số token đầy đủ, model, preview dài hơn, nhật ký gần nhất và từng session phụ. Mỗi bảng trong thread được cập nhật tại chỗ và lưu message ID để tiếp tục dùng sau khi bot khởi động lại. Trước khi gửi phản hồi chính dưới dạng chat thường, bot cập nhật status trước nên câu trả lời luôn nằm mới nhất ở cuối kênh. Trong 2 phút tiếp theo, hoạt động nền chỉ ghi đè vào status cũ để giữ câu trả lời ở cuối; nếu sau 2 phút vẫn có task mới, status được tạo lại ở cuối channel rồi xóa bản cũ. Phản hồi final của phiên chính vẫn đi qua cổng delivery chống gửi trùng. Context ưu tiên snapshot fresh của OpenClaw và fallback về usage provider gần nhất trong transcript; số estimate không được trình bày như usage chính xác. Bot theo dõi transcript của phiên cha cùng mọi session con, kể cả assistant text có `stopReason: toolUse`, `stopReason: stop` hoặc có nội dung trước khi run bị abort. Chỉ dòng rõ ràng `MEDIA:<đường dẫn tuyệt đối>` mới được xem là thành phẩm; tham số của tool `image` và screenshot kiểm tra nội bộ không bao giờ bị nhầm thành thành phẩm. Mỗi file hợp lệ được gửi ngay khi xuất hiện, không chờ đủ cả lô.

Khi OpenClaw chạy `screen.snapshot` hoặc `node C:/oc-tools/shot.js` rồi dùng tool `image` phân tích ảnh, bot cập nhật một gallery Components V2 độc lập ở kênh chính. Gallery giữ **4 ảnh gần nhất**, cho phép bấm mở ảnh đầy đủ và được chốt theo màu/trạng thái cuối khi job kết thúc. Mỗi ảnh mới còn được lưu riêng trong thread chi tiết nên lịch sử cũ hơn bốn ảnh không bị mất. Ảnh được staging theo hash, trạng thái gallery được lưu qua restart và chỉ chấp nhận file hợp lệ trong OpenClaw workspace/media dưới 10 MB; ảnh ngoài allowlist bị bỏ qua im lặng. Gallery này độc lập với thành phẩm `MEDIA:`.

Trạng thái job, transcript offset, hoạt động, thread chi tiết, gallery screenshot, message ID của session phụ, request fingerprint, thời điểm gửi phản hồi, durable task và delivery ledger được lưu nguyên tử tại `data/jobs.json`. Cursor tin nhắn Discord được lưu riêng theo từng kênh, vì vậy khi tiến trình bot khởi động lại, bot giữ nguyên session OpenClaw và quét bù các chat thường được gửi trong lúc offline; lệnh cũ không được tự phát lại. Bộ theo dõi transcript sống theo thời lượng tối đa của request thay vì tự dừng ở phút thứ 5. Bot cũng dò đúng user message trong transcript và gửi nốt phản hồi final chưa delivery của cả job đang chạy lẫn job terminal thất bại trước khi cân nhắc chạy recovery prompt. Task còn chạy được reattach; task đã xong được quét nốt artifact chưa gửi. Nếu RPC không xác minh được task từng đang chạy, bot giữ trạng thái cuối đã biết và báo đồng bộ degraded thay vì tự đánh dấu `lost`, tự recovery hoặc kết thúc job mù quáng.

Lệnh `. o stop` chuyển job sang `stopping` và gửi `tasks.cancel` cho mọi worker đã biết. Mốc cảnh báo mặc định 120 giây chỉ đổi nội dung embed thành “Hủy chưa được OpenClaw xác nhận”; bot vẫn giữ khóa session và theo dõi tiếp. Chỉ khi request cha đã kết thúc, mọi worker đã biết có trạng thái terminal và không xuất hiện task con mới trong cửa sổ xác nhận 10 giây thì job mới chuyển sang `stopped`.

## Cấu hình

Sao chép `.env.example` thành `.env` và điền hai token. `DISCORD_PREFIX` đặt ký tự đầu của mọi lệnh bot (mặc định `>`, bản cài này dùng `.` nên lệnh có dạng `. o m`). `OPENCLAW_BASE_URL` bị giới hạn cứng ở HTTP loopback để tránh vô tình công khai quyền điều khiển máy tính. `OPENCLAW_MEDIA_SOURCE_ROOTS` là danh sách thư mục tuyệt đối phân tách bằng dấu `;`; không cho phép dùng trực tiếp gốc ổ đĩa. `OPENCLAW_BACKEND_MODEL_9ROUTER` và `OPENCLAW_BACKEND_MODEL_LOCAL` đặt model thật tương ứng với hai lệnh chuyển model; `OPENCLAW_MODEL` vẫn phải giữ target Gateway như `openclaw/default`. `OPENCLAW_MAX_CONCURRENT_SESSIONS` mặc định là `2`; giảm về `1` nếu nhiều job cùng điều khiển chung một desktop, chuột, bàn phím hoặc cùng một profile trình duyệt. `OPENCLAW_STREAM_UPDATE_MS` mặc định `2000` ms, giới hạn tần suất cập nhật phần xem trước phản hồi trong status embed. `OPENCLAW_JOB_POLL_MS` là chu kỳ đồng bộ chung cho toàn bot, không còn tạo một CLI poll riêng cho từng job. `OPENCLAW_TASK_RPC_TIMEOUT_MS` giới hạn mỗi lần gọi Admin HTTP RPC; `OPENCLAW_CANCEL_WARNING_MS` chỉ quyết định lúc hiển thị cảnh báo hủy chưa xác nhận, không tự kết thúc job.

OpenClaw cần bật Chat Completions API:

```powershell
& "$env:APPDATA\npm\openclaw.cmd" config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
& "$env:APPDATA\npm\openclaw.cmd" plugins enable admin-http-rpc
& "$env:APPDATA\npm\openclaw.cmd" config validate
& "$env:APPDATA\npm\openclaw.cmd" gateway restart
```

Bot dùng một session và lựa chọn model riêng cho từng channel. Lệnh đổi model không thay đổi job đang chạy; model mới áp dụng từ yêu cầu tiếp theo và được lưu cùng job để quá trình recovery tiếp tục đúng provider. Tối đa `OPENCLAW_MAX_CONCURRENT_SESSIONS` session khác nhau chạy đồng thời; mỗi session chỉ chạy một yêu cầu tại một thời điểm. `OPENCLAW_MAX_PENDING` là tổng số yêu cầu đang chờ trên toàn bot. Các lệnh `status`, `jobs`, `model`, `stop`, `resume` và `resend` được xử lý ngay trong chat Discord, không phải đợi scheduler.

Bot tự đồng bộ profile đang kích hoạt trong app **Claude Profile Switcher** (`~/.claude/settings.json`): khi app kích hoạt profile mới, bot đọc Base URL + API Key + model Opus của profile, đối chiếu với providers trong `~/.openclaw/openclaw.json` rồi tự đổi model cho kênh (chỉ khi fingerprint profile thay đổi nên không đè lệnh chọn model thủ công). Base URL khớp provider anthropic → model `anthropic/<opus_model>`; khớp 9router/ollama → về profile cứng tương ứng. Kênh chưa khớp provider nào (key khác) được giữ nguyên và ghi log cảnh báo. Lệnh `. o m` hiển thị dòng "🔄 Đã tự đồng bộ từ Claude Profile Switcher" khi có thay đổi.

Bảng chọn `. o m` chia 3 cấp để tránh giới hạn 25 options/menu của Discord: cấp 1 là nhóm (Claude gom profile app + từng profile cứng), cấp 2 là profile app (nhóm Claude) hoặc model của backend (nhóm cứng), cấp 3 là model của profile. Model được gom từ: model opus/sonnet/haiku khai báo trong từng profile app, toàn bộ model mà mỗi backend proxy trả về (gọi `/models` hoặc `/v1/models`, cache 5 phút — gồm cả ollama local và 9router) và model khai báo của profile cứng. Mỗi model được chọn qua provider tương ứng (`capp-<slug>/<model>`, `ollama/<model>`, `9router/<model>`, `anthropic/<model>` — route `*` đã đăng ký trong `openclaw.json`) nên chọn được model của backend chưa kích hoạt; backend offline chỉ bị bỏ qua, profile vẫn giữ model khai báo.

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

Cài watchdog tự động restart mỗi 5 phút nếu bot chết (khuyến nghị):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1
```

Restart thủ công từ PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restart-bot.ps1
```

Restart từ xa qua Discord (trong chính Bot OpenClaw):

```
> openclaw restartoc
> o restartoc
> o rsoc
```

> Khi bot còn online nhưng bị treo session hoặc cần reset. Script sẽ spawn `restart-bot.ps1 -ForceKill`, kill process cũ và start lại qua Scheduled Task. Nếu bot đã offline hoàn toàn, Watchdog 5 phút sẽ tự restart.

Cơ chế auto-restart (3 lớp bảo vệ):
1. **Scheduled Task** — tự restart sau 1 phút nếu process crash (tối đa 999 lần)
2. **Watchdog 5 phút** — kiểm tra process Node.js + Task state; nếu bot không chạy → restart
3. **Lệnh Discord** — `?restartoc` từ Bot Đại Ngỗng để restart thủ công từ xa

Task không tự chạy khi đăng nhập. Tạo ứng dụng điều khiển trên Desktop bằng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-control-app.ps1
```

File `OpenClaw Discord Bot.exe` có giao diện trạng thái và các nút Bật bot, Tắt bot, Làm mới, Mở thư mục log. Nút Tắt bot kết thúc cả Scheduled Task lẫn mọi tiến trình Node con còn sót để lần bật sau không tạo bot trùng. Bot được chạy nền qua Task Scheduler nên không xuất hiện cửa sổ console; Task Scheduler vẫn chống chạy trùng và tự restart khi tiến trình đang chạy gặp lỗi.

Với OpenClaw `2026.7.1`, launcher Gateway chạy `scripts/patch-openclaw-browser-proxy-scope.ps1` trước khi khởi động để sửa lỗi `node.invoke` chỉ xin `operator.write` cho `browser.proxy`. Launcher đồng thời đặt `OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1` để browser-control host luôn mở trên cổng Gateway + 2 (`18791` khi Gateway dùng `18789`). Bản vá chỉ áp dụng cho đúng nhánh phiên bản bị lỗi, có backup bundle gốc và tự bỏ qua khi OpenClaw đã nâng cấp.

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
