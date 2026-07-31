# Hướng dẫn chuyển chủ toàn bộ hệ thống Lang Gia

Tài liệu này dùng khi chuyển hệ thống sang người quản lý mới, bao gồm:

- GitHub repository và quyền quản trị source code.
- Ba Discord bot: Đại Ngỗng, Tiểu Ngỗng và Chiến Ngỗng.
- Host chạy bot và dữ liệu SQLite cục bộ.
- Website, API serverless, domain và tài khoản Vercel/host web.
- Supabase Database, Auth, Realtime, RPC và API keys.
- Các dịch vụ ngoài như Cloudinary, ImgBB, Gemini, DeepSeek, Firebase và Discord webhook.

Tài liệu được kiểm kê theo source ngày **31/07/2026**.

## 1. Nguyên tắc bảo mật bắt buộc

Không ghi token, service key, client secret, webhook đầy đủ hoặc mật khẩu vào file này, GitHub Issue, Discord hay tin nhắn không mã hóa.

Secret phải được bàn giao bằng password manager, secret vault hoặc đường dẫn chia sẻ một lần. Sau khi người mới nhận đủ quyền, phải **tạo lại/rotate toàn bộ secret**, kể cả secret cũ vẫn còn hoạt động.

Các loại secret cần rotate:

- Token của cả ba Discord bot.
- Discord OAuth Client Secret dùng cho đăng nhập web.
- Supabase service role/secret key.
- `VOICE_RELAY_LINK_SECRET`.
- Discord webhook.
- Cloudinary API Secret, ImgBB API Key.
- Gemini/DeepSeek API Key.
- Firebase API key hoặc credential liên quan.
- Deploy key, repository secret và hosting credential.

`SUPABASE_ANON_KEY` xuất hiện trong frontend không phải service secret, nhưng vẫn phải được bảo vệ bằng RLS. Tuyệt đối không đưa Supabase service role key vào HTML hoặc JavaScript chạy trên trình duyệt.

## 2. Cách chuyển được khuyến nghị

Nên **chuyển quyền các project hiện có**, không tạo lại từ đầu:

1. Transfer GitHub repository sang tài khoản/organization mới.
2. Tạo Discord Developer Team do tài khoản mới làm Owner, rồi chuyển ba application hiện có vào Team.
3. Transfer Supabase project sang organization mới.
4. Transfer Vercel project sang team mới hoặc import repository vào project mới nếu đổi hẳn nhà cung cấp.
5. Dựng host bot mới, chép dữ liệu SQLite khi bot cũ đã dừng.
6. Rotate token/secret, cập nhật host mới và kiểm tra.
7. Chỉ gỡ quyền tài khoản cũ sau khi hệ thống mới chạy ổn định.

Cách này giữ nguyên Discord bot ID, guild/channel/role ID, dữ liệu Supabase, lịch sử Git và phần lớn URL hiện có. Đây là phương án ít lỗi và ít downtime nhất.

Nếu tạo mới hoàn toàn cả Discord application hoặc Supabase project, xem thêm mục **11. Phương án tạo mới hoàn toàn**.

## 3. Sơ đồ hệ thống cần bàn giao

```text
GitHub repository
    ├── Vercel/host web
    │     ├── WebBangChien/*.html
    │     └── api/*.js
    │
    └── Host bot
          ├── Bot 1: root/index.js
          ├── Bot 2: Bot 2 - Tiểu Ngỗng/index.js
          ├── Bot 3: Bot 3 - Chiến Ngỗng/index.js
          └── data/*.db

Web + API + ba bot
          ↕
       Supabase
          ↕
Discord Guild + Discord OAuth + Discord Webhooks
```

Thông tin hiện tại cần lưu ý:

- Git branch triển khai chính: `master`.
- Web đang dùng cấu hình Vercel tại `vercel.json`.
- Ba bot hiện được khởi động chung bằng `start.sh`.
- `start.sh` đang giả định host dạng Pterodactyl/Bot-Hosting.net với thư mục `/home/container`.
- Database bot không nằm trên GitHub; dữ liệu nằm trong thư mục `data/` của host bot.
- Frontend đang chứa nhiều giá trị Supabase URL/anon key, guild ID và domain dưới dạng hardcode.

## 4. Biểu mẫu thông tin người mới cần chuẩn bị

### 4.1 Thông tin công khai hoặc ID cấu hình

Điền các giá trị này vào một bản bàn giao riêng:

```text
NEW_GITHUB_USERNAME=
NEW_GITHUB_ORGANIZATION=
NEW_REPOSITORY_NAME=
DEPLOY_BRANCH=master

NEW_VERCEL_TEAM=
NEW_VERCEL_PROJECT=
NEW_WEB_DOMAIN=
OLD_WEB_DOMAIN=

NEW_SUPABASE_ORGANIZATION=
SUPABASE_PROJECT_REF=
SUPABASE_URL=

DISCORD_DEVELOPER_TEAM=
BOT1_APPLICATION_ID=
BOT1_USER_ID=
BOT2_APPLICATION_ID=
BOT2_USER_ID=
BOT3_APPLICATION_ID=
BOT3_USER_ID=

MAIN_GUILD_ID=
SECONDARY_ALLOWED_GUILD_ID=
NEW_OWNER_DISCORD_ID=
VOICE_ADMIN_DISCORD_IDS=
LINEUP_EDITOR_DISCORD_IDS=
BC_REMINDER_CHANNEL_ID=
DEFAULT_VOICE_CHANNEL_IDS=
```

Nếu giữ nguyên Discord server và ba application hiện tại thì các bot ID, guild ID, channel ID và role ID không đổi.

### 4.2 Secret chỉ lưu trong vault

```text
BOT1_TOKEN=
BOT2_TOKEN=
BOT3_TOKEN=

DISCORD_OAUTH_CLIENT_SECRET=
SUPABASE_SERVICE_KEY=
VOICE_RELAY_LINK_SECRET=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
IMGBB_API_KEY=

GEMINI_API_KEY_1=
GEMINI_API_KEY_2=
DEEPSEEK_API_KEY=

FIREBASE_PROJECT_OR_ENDPOINT=
FIREBASE_API_KEY_OR_CREDENTIAL=

FEEDBACK_DISCORD_WEBHOOK=
LOGIN_DISCORD_WEBHOOK=
TACTICS_REPORT_DISCORD_WEBHOOK=
```

## 5. Chuyển GitHub sang tài khoản mới

### 5.1 Phương án transfer repository

1. Bật 2FA cho tài khoản GitHub mới.
2. Tạo organization mới nếu muốn source thuộc tổ chức thay vì tài khoản cá nhân.
3. Trên repository cũ vào **Settings → General → Danger Zone → Transfer ownership**.
4. Nhập username/organization mới và xác nhận tên repository.
5. Tài khoản mới kiểm tra quyền Admin, branch, Actions, webhook, deploy key và repository secrets.
6. Re-authorize GitHub App của Vercel/host mới đối với repository đã chuyển.
7. Dù GitHub giữ lại webhook, secrets và deploy keys sau transfer, vẫn phải rotate/review lại toàn bộ.

GitHub tự redirect URL repository cũ sang URL mới, nhưng máy local vẫn nên đổi remote:

```powershell
$gitExe = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
& $gitExe remote set-url origin https://github.com/NEW_OWNER/NEW_REPOSITORY.git
& $gitExe remote -v
& $gitExe status
```

### 5.2 Kiểm tra trước khi cấp repository cho người mới

- `.env` và `data/*.db` không được commit.
- Kiểm tra Git history có token cũ hay không.
- Kiểm tra repository webhook, deploy key, Actions secrets và environment secrets.
- Kiểm tra branch `master` có đúng là Production branch hay không.
- Kiểm tra Vercel và host bot có còn quyền đọc repository sau transfer.

## 6. Chuyển quyền ba Discord bot

### 6.1 Không nên tạo bot mới

Nên giữ nguyên ba Discord application để không phải:

- Mời lại bot vào server.
- Đổi bot user ID trong `TTS_BOT_IDS` và `VOICE_RELAY_BOT_USER_IDS`.
- Tạo lại role của bot và toàn bộ channel permission overwrite.
- Đổi application ID dùng đăng ký slash commands.
- Đổi Discord OAuth application dùng đăng nhập website.

### 6.2 Chuyển application qua Discord Developer Team

Discord yêu cầu tài khoản tham gia Developer Team phải bật 2FA.

Quy trình đề nghị:

1. Tài khoản mới tạo một Discord Developer Team và giữ vai trò Owner.
2. Tài khoản mới mời tài khoản cũ vào Team với vai trò Admin.
3. Tài khoản cũ mở từng application trong Discord Developer Portal.
4. Tại **General Information**, chọn **Transfer App to Team**.
5. Chuyển lần lượt Đại Ngỗng, Tiểu Ngỗng và Chiến Ngỗng vào Team mới.
6. Kiểm tra tài khoản mới nhìn thấy đủ ba application.

Lưu ý: theo tài liệu Discord, application đã chuyển vào Team thì không thể chuyển ngược về sở hữu cá nhân. Hãy kiểm tra đúng Team trước khi xác nhận.

### 6.3 Rotate token và cập nhật host

Sau khi transfer:

1. Reset token của từng bot trong Developer Portal.
2. Điền token mới vào đúng file `.env` trên host mới.
3. Không chạy host cũ và host mới đồng thời bằng cùng token.
4. Nếu Discord OAuth dùng chung application với một bot, kiểm tra lại Client ID/Client Secret trong Supabase Auth.

### 6.4 Privileged Gateway Intents

Trong Developer Portal, kiểm tra cả ba bot đã bật:

- **Server Members Intent**.
- **Message Content Intent**.

Bot 1 sử dụng thêm Guild Messages, Guild Voice States và Guild Message Reactions trong code. Bot 2 và Bot 3 sử dụng Guild Messages, Guild Members, Message Content và Guild Voice States.

### 6.5 Quyền bot trong Discord server

Nếu giữ nguyên application và server thì role bot hiện tại vẫn còn. Vẫn phải kiểm tra các nhóm quyền sau:

- View Channel, Send Messages, Read Message History.
- Embed Links, Attach Files, Add Reactions.
- Connect, Speak, Use Voice Activity, Stream.
- Manage Messages khi dùng chức năng dọn nội dung.
- Manage Roles cho reaction role/cấp role.
- Manage Channels, Move Members và Mute Members cho voice/booster room.

Không cấp `Administrator` nếu không thật sự cần; ưu tiên giữ đúng role/permission hiện đang hoạt động.

## 7. Chuyển Supabase

### 7.1 Khuyến nghị: transfer nguyên project

Transfer project giúp giữ database, Auth users, RPC, RLS, Realtime và dữ liệu hiện tại.

Điều kiện Supabase hiện công bố:

- Người chuyển phải là Owner của organization nguồn.
- Người chuyển phải là thành viên organization đích.
- Project không có active GitHub integration connection.
- Project không còn project-scoped role hoặc log drain cản transfer.
- Chuyển từ gói trả phí về Free có thể gây gián đoạn ngắn và mất một số tính năng theo plan.

Quy trình:

1. Tài khoản mới tạo Supabase organization.
2. Mời tài khoản cũ/new account vào đúng organization theo yêu cầu transfer.
3. Tạo một database backup trước khi chuyển.
4. Vào **Project Settings → General → Transfer Project**.
5. Chọn organization đích và hoàn tất kiểm tra billing/add-ons.
6. Sau transfer, kiểm tra Project URL, API keys, Auth provider, Realtime, database và logs.
7. Rotate service role/secret key và cập nhật tất cả host.

### 7.2 Nếu tạo Supabase project mới

Repo hiện **không có một file bootstrap SQL đầy đủ** để dựng lại toàn bộ hệ thống Bang Chiến từ số 0. Các file trong `scripts/` chủ yếu là migration bổ sung. Vì vậy phải export schema/data từ project cũ bằng Supabase backup hoặc `pg_dump`.

Các bảng code hiện đang sử dụng gồm:

```text
bc_exp_levels
bc_feedback
bc_logs
bc_pending_ids
bc_regulars
bc_roster_snapshots
bc_sessions
bc_tactics
bc_tactics_history
bc_tactics_presets
bc_users

voice_relay_config
voice_relay_guild_meta
voice_relay_managed_channels
voice_relay_master
voice_relay_status
```

Các RPC được code gọi trực tiếp:

```text
bc_manager_add_member_to_session
bc_manager_delete_pending
bc_manager_update_member
bc_manager_update_pending
bc_manager_update_web_weapon_roles
bc_update_own_pickrole
bc_update_own_session_registration
```

Sau khi import schema/data:

1. Kiểm tra primary key, unique index, trigger và function.
2. Bật RLS và tạo lại policy cho frontend authenticated/anon.
3. Không cấp quyền ghi rộng cho anon key; thao tác nhạy cảm đi qua RPC hoặc API server.
4. Bật Realtime publication cho các bảng web/bot đang subscribe.
5. Chạy các migration phù hợp trong `scripts/`.
6. Chạy `db/voice_relay_schema.sql`, `db/voice_relay_3bot.sql` và các migration voice liên quan nếu dùng relay.
7. Cấu hình lại Discord Auth.
8. Kiểm tra dữ liệu `auth.users` và liên kết Discord `provider_id` với `bc_users.discord_id`.

### 7.3 Cấu hình Discord OAuth trong Supabase

1. Bật Discord provider trong **Authentication → Providers**.
2. Nhập Discord OAuth Client ID và Client Secret.
3. Trong Discord Developer Portal, redirect URL phải có dạng:

```text
https://SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback
```

4. Trong Supabase Auth URL Configuration, đặt Site URL và Additional Redirect URLs cho domain web mới, gồm tối thiểu:

```text
https://NEW_WEB_DOMAIN/
https://NEW_WEB_DOMAIN/index.html
https://NEW_WEB_DOMAIN/callback.html
```

5. Giữ domain cũ trong allowlist trong thời gian chuyển tiếp nếu vẫn cần rollback.

### 7.4 Những nơi phải cập nhật nếu đổi Supabase project

`SUPABASE_URL` và `SUPABASE_ANON_KEY` đang được khai báo trực tiếp ở nhiều file:

- `WebBangChien/index.html`
- `WebBangChien/callback.html`
- `WebBangChien/member_roster.html`
- `WebBangChien/team_editor.html`
- `WebBangChien/tactics.html`
- `WebBangChien/tactic_sketch.html`
- `WebBangChien/voice-editor.html`
- `WebBangChien/minigames/core/app.js`

Service key phải cập nhật trong:

- `.env` của Bot 1.
- `.env` của Bot 2.
- `.env` của Bot 3.
- Environment Variables của Vercel/host API.

## 8. Chuyển web sang tài khoản hoặc host mới

### 8.1 Nếu vẫn dùng Vercel

Vercel hỗ trợ transfer project giữa các team với zero downtime. Theo tài liệu Vercel, project transfer mang theo deployments, environment variables, project configuration, domain/alias, project name, build settings và Git repository link. Các integration có thể phải cài lại.

Quy trình:

1. Tài khoản mới tạo/join Vercel team đích.
2. Tài khoản cũ phải là Owner của team nguồn.
3. Transfer project trong **Project Settings → General → Transfer Project**.
4. Kiểm tra GitHub integration và cấp lại quyền repository cho Vercel App.
5. Kiểm tra environment variables ở Production, Preview và Development.
6. Kiểm tra domain, DNS, SSL và Production branch.
7. Redeploy một bản mới từ branch `master`.

Máy local hiện có `.vercel/project.json` liên kết project cũ. Sau khi chuyển/import project mới, chạy lại `vercel link` hoặc xóa liên kết local bằng Vercel CLI rồi link đúng project mới. Không dùng nhầm project ID cũ.

### 8.2 Nếu chuyển sang host khác Vercel

Host mới phải hỗ trợ đồng thời:

- Static HTML/CSS/JS và asset lớn trong `WebBangChien/`.
- Node.js serverless/API routes tương đương thư mục `api/`.
- Biến môi trường bí mật cho API.
- Rewrite từ `/` vào `WebBangChien/index.html`.
- Rewrite các đường dẫn web vào `WebBangChien/:path*`.
- Không rewrite `/api/*` thành file tĩnh.
- HTTPS và WebSocket outbound để Supabase Realtime hoạt động.

Nếu host chỉ hỗ trợ static site thì các API đăng ký Bang Chiến, chỉnh đội hình, reminder và voice config sẽ không hoạt động. Khi dùng Netlify, Cloudflare hoặc VPS, phải port các file `api/*.js` sang cơ chế function/server tương ứng.

### 8.3 Environment Variables cần nhập cho API web

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY

# Bot 1 token dùng khi API gửi reminder trực tiếp sang Discord.
DISCORD_BOT_TOKEN=YOUR_BOT1_TOKEN

# Dùng khi phiên Bang Chiến chưa có channel_id.
BC_REMINDER_CHANNEL_ID=YOUR_CHANNEL_ID

# Danh sách Discord ID được quản trị voice, phân tách bằng dấu phẩy.
VOICE_ADMIN_DISCORD_IDS=DISCORD_ID_1,DISCORD_ID_2
```

Code cũng chấp nhận tên thay thế `SUPABASE_SERVICE_ROLE_KEY` hoặc `SUPABASE_SECRET_KEY`, nhưng nên thống nhất dùng `SUPABASE_SERVICE_KEY`.

### 8.4 Những nơi phải cập nhật nếu đổi domain

- `canonicalHost` trong `WebBangChien/index.html`.
- `canonicalHost` trong `WebBangChien/callback.html`.
- Link web trong `src/commands/bangchien/bangchien.js`.
- Link web trong `src/commands/bangchien/listbangchien.js`.
- Mô tả hệ thống trong `WebBangChien/tong-quan-he-thong.html`.
- Supabase Site URL và Additional Redirect URLs.
- Discord OAuth redirect liên quan.
- Domain/DNS tại nhà cung cấp tên miền nếu dùng custom domain.

Không bật redirect bắt buộc sang domain mới trước khi domain mới đã deploy và đăng nhập Discord thành công.

## 9. Chuyển host bot

### 9.1 Yêu cầu host mới

- Node.js tương thích với phiên bản đang chạy ổn định trên host cũ. Ghi lại kết quả `node -v` trước khi chuyển.
- Linux hoặc môi trường chạy được các native dependency như `better-sqlite3`, `@discordjs/opus`, `sharp` và `sodium-native`.
- Có filesystem bền vững; không dùng host xóa dữ liệu sau restart/redeploy.
- Có outbound HTTPS tới Discord, Supabase, Cloudinary, ImgBB, Gemini/DeepSeek và các dịch vụ liên quan.
- Có outbound/inbound WebSocket cho voice relay nếu ba bot không chạy cùng một máy.
- Có đủ RAM/CPU cho ba bot, xử lý voice, canvas, SQLite và ffmpeg.

### 9.2 Dữ liệu bắt buộc sao lưu từ host cũ

Dừng toàn bộ bot trước khi chép database để tránh snapshot SQLite không nhất quán.

Sao lưu:

```text
.env
Bot 2 - Tiểu Ngỗng/.env
Bot 3 - Chiến Ngỗng/.env
data/
```

Thư mục `data/` có thể chứa:

```text
data/users.db
data/exp.db
data/economy.db        # dữ liệu legacy nếu còn
data/*.db-wal
data/*.db-shm
```

Tốt nhất sao lưu nguyên thư mục `data/` sau khi bot đã tắt. Không cần chép `node_modules`; chạy lại `npm ci` trên host mới.

Ảnh đã tải lên Cloudinary/ImgBB không nằm trong `data/`. Nếu đổi luôn tài khoản lưu ảnh, phải export/migrate riêng hoặc giữ tài khoản cũ hoạt động để các URL trong database không bị chết.

### 9.3 Cài đặt host mới

```bash
git clone https://github.com/NEW_OWNER/NEW_REPOSITORY.git
cd NEW_REPOSITORY
git checkout master
npm ci
npm test
```

Sau đó:

1. Upload ba file `.env` mới.
2. Restore thư mục `data/`.
3. Kiểm tra quyền đọc/ghi của user chạy Node đối với `data/`.
4. Chỉ bật một host bot tại một thời điểm.

### 9.4 Lưu ý về `start.sh`

`start.sh` hiện có:

- `cd /home/container`, chỉ phù hợp với host có đường dẫn này.
- Khởi động ba bot trong cùng một service.
- Bot 1 làm WebSocket server, sau đó mới khởi động Bot 2 và Bot 3.
- Xóa các thư mục web/tài nguyên khỏi bản chạy bot để tiết kiệm dung lượng.

Nếu host mới không dùng `/home/container`, phải sửa working directory hoặc bỏ dòng `cd`.

Không dùng cùng một working copy để vừa host web vừa chạy `start.sh`, vì script có thể xóa `WebBangChien`, `WebTimer`, `anh` và `rac` trên bản chạy bot.

Nếu cả ba bot chạy cùng máy:

- Bot 1: `VOICE_RELAY_LINK_MODE=server`.
- Bot 2/3: `VOICE_RELAY_LINK_MODE=client`.
- Bot 2/3 có thể dùng `VOICE_RELAY_LINK_URL=ws://127.0.0.1:8790`.
- Cả ba phải dùng cùng `VOICE_RELAY_LINK_SECRET`.

Nếu ba bot chạy khác máy, Bot 1 phải mở port relay và Bot 2/3 phải trỏ tới hostname/port của Bot 1. Chỉ mở port cho các IP cần thiết nếu host hỗ trợ firewall.

## 10. Mẫu biến môi trường cho host bot

### 10.1 Bot 1 - Đại Ngỗng (`/.env`)

Các biến cốt lõi:

```env
token=YOUR_BOT1_TOKEN
clientId=YOUR_BOT1_APPLICATION_ID
PREFIX=?
OWNER_ID=NEW_OWNER_DISCORD_ID

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY

TTS_BOT_IDS=BOT1_USER_ID,BOT2_USER_ID,BOT3_USER_ID
TTS_BOT_PRIORITY=BOT1_USER_ID,BOT2_USER_ID,BOT3_USER_ID
TTS_COMMAND_PREFIX=?
VOICE_RELAY_BOT_USER_IDS=BOT1_USER_ID,BOT2_USER_ID,BOT3_USER_ID

VOICE_RELAY_ENABLED=false
VOICE_RELAY_BOT_ID=1
VOICE_RELAY_GUILD_ID=MAIN_GUILD_ID
VOICE_RELAY_LINK_MODE=server
VOICE_RELAY_LINK_PORT=8790
VOICE_RELAY_LINK_SECRET=RANDOM_LONG_SECRET
VOICE_RELAY_COMMAND_PREFIX=?relay
VOICE_RELAY_ALT_PREFIXES=?vr
VOICE_RELAY_REQUIRE_ADMIN_COMMANDS=true
VOICE_RELAY_COMMAND_ADMIN_IDS=NEW_OWNER_DISCORD_ID
VOICE_RELAY_JITTER_MS=400
```

Các dịch vụ tùy chọn theo tính năng đang dùng:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
IMGBB_API_KEY=

GEMINI_API_KEY=
GEMINI_API_KEY_1=
GEMINI_API_KEY_2=

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=
DEEPSEEK_THINKING=disabled
DEEPSEEK_MAX_RETRIES=1
DEEPSEEK_TIMEOUT_MS=30000
DEEPSEEK_MAX_TOKENS=700
DEEPSEEK_TEMPERATURE=0.9
```

Code hỗ trợ cả tên viết sai cũ `DEEPSEAK_*`, nhưng hệ thống mới nên dùng `DEEPSEEK_*` đúng chính tả.

### 10.2 Bot 2 - Tiểu Ngỗng

Dùng `Bot 2 - Tiểu Ngỗng/.env.example` làm mẫu. Tối thiểu cần:

```env
BOT2_TOKEN=YOUR_BOT2_TOKEN
BOT2_PREFIX=!
BOT2_GUILD_ID=MAIN_GUILD_ID

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY

VOICE_RELAY_ENABLED=false
VOICE_RELAY_BOT_ID=2
VOICE_RELAY_GUILD_ID=MAIN_GUILD_ID
VOICE_RELAY_LINK_MODE=client
VOICE_RELAY_LINK_URL=ws://127.0.0.1:8790
VOICE_RELAY_LINK_SECRET=SAME_SECRET_AS_BOT1
```

### 10.3 Bot 3 - Chiến Ngỗng

Dùng `Bot 3 - Chiến Ngỗng/.env.example` làm mẫu. Tối thiểu cần:

```env
BOT3_TOKEN=YOUR_BOT3_TOKEN
BOT3_PREFIX=#
BOT3_GUILD_ID=MAIN_GUILD_ID

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY

VOICE_RELAY_ENABLED=false
VOICE_RELAY_BOT_ID=3
VOICE_RELAY_GUILD_ID=MAIN_GUILD_ID
VOICE_RELAY_LINK_MODE=client
VOICE_RELAY_LINK_URL=ws://127.0.0.1:8790
VOICE_RELAY_LINK_SECRET=SAME_SECRET_AS_BOT1
```

Giữ `VOICE_RELAY_ENABLED=false` nếu muốn tiếp tục tắt chế độ relay/tự động cho đến khi người mới kiểm tra xong.

## 11. Phương án tạo mới hoàn toàn

Chỉ dùng phương án này khi không thể transfer các account/project cũ.

### 11.1 Nếu tạo ba Discord application mới

Phải làm lại:

- Mời ba bot mới vào Discord server.
- Role và channel permission của từng bot.
- Privileged intents.
- `clientId` và ba token.
- `TTS_BOT_IDS`, `TTS_BOT_PRIORITY`, `VOICE_RELAY_BOT_USER_IDS`.
- Discord OAuth Client ID/Secret trong Supabase.
- Các allowlist hoặc cấu hình chứa bot/user ID.
- Kiểm tra các message/webhook/channel cũ có phụ thuộc bot ID hay không.

### 11.2 Nếu đổi sang Discord server mới

Phải kiểm kê và thay toàn bộ guild ID, channel ID, role ID, emoji ID và webhook. Source có nhiều Discord snowflake hardcode ngoài các file cấu hình chính. Dùng tìm kiếm sau để lập danh sách:

```powershell
rg -n "[0-9]{17,20}" src WebBangChien api
```

Đây là một migration riêng, lớn hơn nhiều so với chỉ đổi chủ bot.

### 11.3 Nếu tạo Supabase project mới

Phải thực hiện đầy đủ mục 7.2. Không được chỉ chạy các file SQL trong `scripts/` rồi cho rằng schema đã hoàn chỉnh.

### 11.4 Nếu tạo Vercel project mới

1. Import repository mới.
2. Root Directory để ở repository root.
3. Giữ `vercel.json`.
4. Nhập Environment Variables.
5. Deploy Preview trước.
6. Thêm domain mới.
7. Cập nhật Supabase redirect và code hardcode.
8. Chuyển DNS sau khi login/API đã kiểm tra đạt.

## 12. Danh sách giá trị hardcode cần rà soát

### 12.1 Domain và repository

- `WebBangChien/index.html`
- `WebBangChien/callback.html`
- `WebBangChien/tong-quan-he-thong.html`
- `src/commands/bangchien/bangchien.js`
- `src/commands/bangchien/listbangchien.js`

### 12.2 Guild, owner, KC và editor allowlist

- `src/config/guildAccess.js`
- `api/bc-self-registration.js`
- `api/bc-lineup-editor.js`
- `api/bc-league-reminder.js`
- `api/voice-config.js`
- `WebBangChien/index.html`
- `WebBangChien/member_roster.html`
- `WebBangChien/team_editor.html`
- `WebBangChien/tactics.html`
- `WebBangChien/tactic_sketch.html`
- `WebBangChien/voice-editor.html`

Đặc biệt cần thay `OWNER_ID`, owner Discord ID, `KC_WEB_ACCESS_DISCORD_IDS`, `LINEUP_EDITOR_DISCORD_IDS`, `ADMIN_IDS` và `VOICE_ADMIN_DISCORD_IDS` theo người quản lý mới.

### 12.3 Secret đang hardcode trong source

Source hiện có các vị trí cần xử lý bảo mật:

- Hai Discord webhook trong `WebBangChien/index.html`.
- Một Discord webhook trong `src/utils/tacticsStorageReport.js`.
- Firebase API/config trong `src/utils/firebaseLicense.js`.
- Supabase anon key lặp lại ở nhiều file frontend.

Trước khi kết thúc bàn giao:

1. Reset ba webhook cũ.
2. Rotate Firebase credential/key nếu có thể.
3. Chuyển secret server-side sang environment variables ở một đợt sửa code riêng.
4. Không dùng lại service key/token đã từng xuất hiện trong Git history hoặc chat.

### 12.4 Công tắc vận hành phải giữ nguyên khi chuyển

Trước khi bật host mới, đối chiếu các công tắc trong:

- `src/config/autoFeatures.js`.
- `src/utils/bangchienState.js`.
- `WebBangChien/index.html`.

Theo trạng thái hiện tại, chế độ tự tạo phiên Bang Chiến vẫn phải được giữ tắt bằng `BC_AUTO_CREATE_DISABLED=true`. Không tự đổi thành `false` trong lúc chuyển host. Các tính năng tự động khác cũng phải giữ đúng trạng thái cũ cho đến khi người quản lý mới xác nhận bật lại.

## 13. Thứ tự cutover đề nghị

### Giai đoạn A - Chuẩn bị, chưa ảnh hưởng production

- [ ] Tài khoản mới bật 2FA cho GitHub, Discord, Vercel và Supabase.
- [ ] Tạo organization/team mới.
- [ ] Transfer GitHub repository.
- [ ] Chuyển ba Discord application vào Developer Team.
- [ ] Transfer Supabase project và tạo backup.
- [ ] Transfer/import Vercel project.
- [ ] Cấp quyền GitHub integration cho Vercel/host mới.
- [ ] Dựng host bot mới nhưng chưa khởi động bot.
- [ ] Nhập environment variables bằng secret vault.
- [ ] Deploy web Preview và kiểm tra API.

### Giai đoạn B - Chuyển bot

- [ ] Tắt toàn bộ bot trên host cũ.
- [ ] Sao lưu ba file `.env` và toàn bộ `data/`.
- [ ] Reset token ba bot.
- [ ] Điền token mới vào host mới.
- [ ] Restore `data/` vào host mới.
- [ ] Chạy `npm ci` và `npm test`.
- [ ] Khởi động Bot 1 trước, sau đó Bot 2 và Bot 3.
- [ ] Kiểm tra không còn bot nào chạy ở host cũ.

### Giai đoạn C - Chuyển web/domain

- [ ] Cập nhật domain hardcode trong source nếu đổi domain.
- [ ] Cập nhật Supabase Auth redirect URLs.
- [ ] Cập nhật Discord OAuth callback nếu đổi Supabase project.
- [ ] Cập nhật DNS/custom domain.
- [ ] Kiểm tra HTTPS và canonical redirect.
- [ ] Kiểm tra web đăng nhập Discord thành công.

### Giai đoạn D - Thu hồi quyền cũ

- [ ] Xóa tài khoản cũ khỏi GitHub organization/team.
- [ ] Xóa tài khoản cũ khỏi Vercel team.
- [ ] Xóa tài khoản cũ khỏi Supabase organization.
- [ ] Xóa tài khoản cũ khỏi Discord Developer Team sau khi đã xác nhận quyền mới.
- [ ] Revoke deploy keys, API keys và webhook cũ.
- [ ] Tắt/xóa host cũ sau thời gian rollback.

## 14. Checklist kiểm tra sau chuyển

### GitHub

- [ ] Tài khoản mới có quyền Admin.
- [ ] `origin` trỏ đúng repository mới.
- [ ] Push/clone hoạt động.
- [ ] Vercel/host bot nhận được commit mới.

### Website

- [ ] Trang chủ và asset tải bình thường.
- [ ] Không bị redirect về domain cũ.
- [ ] Đăng nhập Discord desktop và mobile hoạt động.
- [ ] Người dùng được đối chiếu đúng với `bc_users`.
- [ ] Danh sách Bang Chiến tải được.
- [ ] Đăng ký/hủy đăng ký hoạt động.
- [ ] Team editor, tactics, roster và voice editor đúng quyền.
- [ ] `/api/*` không trả lỗi thiếu environment variables.
- [ ] Supabase Realtime nhận cập nhật.

### Bot

- [ ] Ba bot đều online đúng account.
- [ ] Bot chỉ ở các guild được cho phép.
- [ ] Prefix `?`, `!`, `#` hoạt động.
- [ ] Slash commands của Bot 1 đăng ký thành công với `clientId` mới/đúng.
- [ ] Bot đọc được `data/users.db` và `data/exp.db`.
- [ ] Đồng bộ `bc_users`, `bc_sessions` và `bc_regulars` hoạt động.
- [ ] `BC_AUTO_CREATE_DISABLED=true`, bot không tự tạo phiên Bang Chiến.
- [ ] TTS và voice join hoạt động.
- [ ] Voice relay vẫn tắt nếu `VOICE_RELAY_ENABLED=false`.
- [ ] Không có hai instance cùng đăng nhập một bot token.

### Supabase

- [ ] Database và Auth users còn đủ.
- [ ] Discord provider hoạt động.
- [ ] RLS không mở quyền ghi ngoài ý muốn.
- [ ] RPC đăng ký/chỉnh sửa hoạt động.
- [ ] Realtime publication có đủ bảng.
- [ ] Service key mới đã cập nhật ở bot và API.
- [ ] Service key cũ đã bị revoke/rotate.

## 15. Rollback

Giữ host cũ ở trạng thái **đã tắt**, chưa xóa ngay trong 24-48 giờ đầu.

Nếu host mới lỗi:

1. Dừng bot host mới.
2. Cập nhật token mới vào host cũ nếu token đã reset.
3. Restore snapshot `data/` gần nhất nếu đã phát sinh dữ liệu mới.
4. Khởi động lại host cũ.

Nếu web mới lỗi:

1. Rollback deployment trên Vercel hoặc trỏ DNS về deployment cũ.
2. Giữ cả domain cũ và mới trong Supabase redirect allowlist trong thời gian chuyển tiếp.
3. Không chạy đồng thời hai backend bot; website có thể có nhiều deployment đọc cùng Supabase nhưng cần tránh người dùng thao tác trên phiên lỗi.

## 16. Tài liệu chính thức tham khảo

- GitHub - Transfer repository: https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository
- Discord - Managing Developer Team: https://docs.discord.com/developers/topics/teams
- Vercel - Transfer project: https://vercel.com/docs/projects/transferring-projects
- Supabase - Transfer project: https://supabase.com/docs/guides/platform/project-transfer
- Supabase - Discord OAuth: https://supabase.com/docs/guides/auth/social-login/auth-discord
- Supabase - API keys: https://supabase.com/docs/guides/api/api-keys
- Supabase - Postgres Changes/Realtime: https://supabase.com/docs/guides/realtime/postgres-changes

## 17. Điều kiện xác nhận bàn giao hoàn tất

Chỉ coi là hoàn tất khi:

- Người mới có quyền Owner/Admin thực tế trên GitHub, Discord Developer Team, Vercel và Supabase.
- Ba bot chạy duy nhất trên host mới với token đã rotate.
- Dữ liệu SQLite và Supabase được kiểm tra đầy đủ.
- Website đăng nhập Discord, API và Realtime hoạt động trên domain mới.
- Tài khoản cũ đã bị thu hồi quyền.
- Tất cả token, service key, webhook và API key cũ đã bị rotate hoặc revoke.
