# Hướng dẫn sử dụng Website và Bot Lang Gia

Tài liệu này dành cho thành viên, Kỳ Cựu, Leader và người vận hành hệ thống Lang Gia.

Hệ thống gồm:

- Website Bang Chiến và các công cụ chiến thuật.
- Bot 1 - Đại Ngỗng: bot chính quản lý guild.
- Bot 2 - Tiểu Ngỗng: TTS và voice relay phụ.
- Bot 3 - Chiến Ngỗng: TTS và voice relay phụ.
- Supabase: dữ liệu chung giữa website và bot.
- SQLite: dữ liệu cục bộ trên host bot.

## 1. Trạng thái vận hành hiện tại

- Website đang được mở để sử dụng bình thường.
- Chế độ tự tạo phiên Bang Chiến vẫn tắt bằng `BC_AUTO_CREATE_DISABLED=true`.
- Voice relay chỉ chạy khi `VOICE_RELAY_ENABLED=true`; mặc định trong file mẫu là `false`.
- Không tự bật các chức năng tự động nếu chưa được người quản lý xác nhận.

## 2. Phân quyền người dùng

### Thành viên

Có thể:

- Đăng nhập website bằng Discord.
- Xem các phiên Bang Chiến.
- Đăng ký hoặc hủy đăng ký Bang Chiến.
- Chọn vai trò chiến đấu và vũ khí web nếu được cấp quyền.
- Xem đội hình, bản đồ, nhiệm vụ, timer và chiến thuật đã công bố.
- Dùng các lệnh bot phổ thông như EXP, dịch, TTS, album, bình chọn và minigame.

### Kỳ Cựu

Ngoài quyền thành viên, có thể được phép:

- Xem danh sách thành viên.
- Dùng các công cụ quản lý Bang Chiến.
- Mở Team Editor, Tactics hoặc Voice Editor tùy allowlist và vị trí trong `bc_users`.
- Tạo thông báo, sự kiện hoặc party Boss theo quyền Discord hiện có.

### Leader, Phó Bang Chủ, Bang Chủ và Quản Lý

Có thể:

- Tạo, sửa, chốt, kết thúc hoặc hủy phiên Bang Chiến.
- Chia team, đặt leader, chỉ huy, số lượng team và quyền mic.
- Chỉnh thành viên, UID, vai trò, ngày vào guild và trạng thái rời guild.
- Quản lý thông báo, role, voice room và cấu hình ba bot voice.

Quyền cuối cùng luôn được kiểm tra lại ở API hoặc bot. Việc một nút xuất hiện trên giao diện không đồng nghĩa người dùng chắc chắn có quyền thực hiện thao tác đó.

## 3. Sử dụng Website Bang Chiến

### 3.1 Đăng nhập

1. Mở website Lang Gia.
2. Chọn đăng nhập bằng Discord.
3. Cho phép Discord xác thực qua Supabase.
4. Website đối chiếu Discord ID với bảng `bc_users`.
5. Nếu chưa thuộc danh sách Lang Gia, liên hệ Leader/Admin để được thêm thành viên.

Nếu popup đăng nhập bị chặn trên desktop, website sẽ chuyển sang đăng nhập bằng redirect. Trên điện thoại, hệ thống tự dùng redirect.

### 3.2 Chọn phiên Bang Chiến

- Chọn ngày hoặc phiên muốn xem trên thanh phiên.
- Mỗi phiên có thể có giờ, trạng thái khóa và đội hình riêng.
- Khi Leader cập nhật Supabase, website nhận dữ liệu qua Realtime và tự tải lại.

### 3.3 Đăng ký hoặc hủy đăng ký

1. Bấm **Đăng ký Bang Chiến** hoặc **Cập nhật đăng ký**.
2. Tích các phiên muốn tham gia.
3. Bỏ tích phiên muốn hủy.
4. Xác nhận thay đổi.

Người dùng phải:

- Đăng nhập Discord hợp lệ.
- Có dòng thành viên hoạt động trong `bc_users`.
- Không ở trạng thái đã rời guild.
- Không bị khóa bởi trạng thái phiên hoặc quyền truy cập.

### 3.4 Chọn vai trò và vũ khí

- Combat role gồm DPS, Healer và Tanker.
- Website có thể cho chọn thêm hai icon vũ khí dành riêng cho giao diện.
- Thay đổi được lưu vào Supabase và có thể được bot đồng bộ.
- Nếu không thấy nút chọn, tài khoản chưa đủ quyền hoặc chức năng đang bị khóa.

### 3.5 Xem đội hình

Mỗi phiên có thể gồm:

- Team Công 1.
- Team Công 2.
- Team Thủ.
- Team Rừng.
- Các team động do Leader tạo thêm.
- Danh sách chờ.

Thành viên nên kiểm tra lại team, nhiệm vụ và leader trước giờ đánh.

### 3.6 Bản đồ, nhiệm vụ và timer

- Tab bản đồ hiển thị trụ, boss, điểm rừng và vị trí chiến thuật.
- Tab nhiệm vụ hiển thị công việc theo người hoặc theo team.
- Timer Bang Chiến hỗ trợ đặt thời gian, bắt đầu, tạm dừng, reset và cảnh báo mốc.
- Trên mobile, dùng thanh tab phía dưới để chuyển giữa đội hình, bản đồ, nhiệm vụ và timer.

## 4. Các trang web dành cho Leader và quản trị

### 4.1 Team Editor - `team_editor.html`

Dùng để:

- Kéo thả thành viên giữa các team.
- Tạo hoặc xóa team động.
- Đổi tên team và số lượng thành viên tối đa.
- Đặt leader/chỉ huy.
- Lọc thành viên theo combat role hoặc vũ khí.
- Chia nhanh, kiểm tra đội hình và lưu lịch sử chỉnh sửa.
- Chốt đội hình hoặc khôi phục từ dữ liệu trước đó.

Nên chọn đúng phiên/ngày trước khi chỉnh. Không mở hai tab Team Editor cùng sửa một phiên nếu không cần thiết.

### 4.2 Tactics - `tactics.html`

Dùng để:

- Đặt thành viên lên bản đồ.
- Chỉ định trụ, rừng, boss và nhiệm vụ.
- Tạo mốc timeline trong trận.
- Thêm đối thủ hoặc quân giả lập.
- Lưu preset, lịch sử chiến thuật và khôi phục phiên bản.
- Xuất/nhập dữ liệu chiến thuật khi cần.

### 4.3 Phác thảo chiến thuật - `tactic_sketch.html`

Dùng như bảng vẽ nhanh:

- Đặt marker người chơi.
- Vẽ đường và mũi tên.
- Kéo thả vị trí.
- Tạo nhiều mốc thời gian.
- Hoàn tác, làm lại, nhân bản và lưu bản vẽ.

### 4.4 Danh sách thành viên - `member_roster.html`

Cho phép người có quyền:

- Tìm theo tên Discord, tên game hoặc UID.
- Lọc theo chức vụ và trạng thái.
- Xem người đang hoạt động, đang chờ hoặc đã rời guild.
- Sửa tên game, UID, ngày tham gia và vai trò.
- Xem lịch sử thay đổi liên quan.

### 4.5 Voice Editor - `voice-editor.html`

Dùng để quản lý Đại Ngỗng, Tiểu Ngỗng và Chiến Ngỗng:

- Xem trạng thái online và phòng voice hiện tại.
- Chọn phòng voice tự động hoặc thủ công.
- Bật/tắt relay.
- Chọn bridge hoặc broadcast.
- Đặt role được nói, role bị chặn và ưu tiên người nói.
- Cho từng bot join lại, rời phòng hoặc tắt toàn hệ thống.
- Cấu hình bot tự tạo kênh voice nếu tính năng được bật.

API phía server sẽ xác minh Discord access token và quyền Kỳ Cựu/Admin trước khi lưu cấu hình.

### 4.6 Minigame - `minigames.html`

Hệ thống hiện có source cho:

- Leo tháp.
- Plinko 3D.
- Đua tốc độ.

Có thể nhập người chơi từ phiên Bang Chiến, mở sảnh, phát nhạc, theo dõi kết quả và dùng chế độ 2D dự phòng khi máy không hỗ trợ 3D tốt.

## 5. Bot 1 - Đại Ngỗng

Đại Ngỗng là bot chính. Prefix mặc định là `?`.

Các nhóm chức năng:

- Bang Chiến.
- Quản lý thành viên.
- Thông báo và lịch guild.
- EXP và bảng xếp hạng.
- Album/ảnh đại diện.
- TTS, dịch, bình chọn và tiện ích cộng đồng.
- Lô tô, gieo quẻ và cầu duyên.
- Booster voice room.
- Điều phối voice relay với Bot 2 và Bot 3.

## 6. Lệnh Bang Chiến

### Thành viên

```text
?bc                      Xem tổng quan các phiên đang mở
?bc t7                   Xem/đăng ký phiên Thứ Bảy
?bc cn                   Xem/đăng ký phiên Chủ Nhật
?bcrole t7 dps           Xem người đăng ký theo role
?lenhbc                  Xem danh sách lệnh Bang Chiến
```

### Leader và quản lý

```text
?setbc                   Đặt kênh hiện tại làm kênh Bang Chiến mặc định
?bcql t7                 Mở panel quản lý phiên Thứ Bảy
?bcql cn                 Mở panel quản lý phiên Chủ Nhật

?bcadd t7 @user 1        Thêm người vào team
?bcmove t7 @user 2       Chuyển người sang team khác
?bcdoi t7 1 2            Đổi vị trí/team theo lệnh hỗ trợ
?bcleader t7 1 @user     Đặt leader cho team
?bcchihuy t7 @user       Đặt chỉ huy

?bcmute                  Tắt mic người trong voice Bang Chiến
?bcmic                   Mở mic
?bcmicreset              Reset quyền mic

?bcchot t7               Chốt danh sách và thêm role
?bcend t7                Kết thúc phiên
?huybc t7                Hủy phiên
?huybc all               Hủy tất cả phiên phù hợp
```

Lệnh `?bcsize` đã khóa; dùng nút Resize trong `?bcql` hoặc Team Editor trên web.

## 7. Lệnh thành viên và vai trò

```text
?lenhquanly              Xem nhóm lệnh quản lý
?addhelp                 Xem hướng dẫn thêm thành viên/UID

?addid                   Thêm UID vào danh sách chờ
?listid                  Xem danh sách UID chờ
?addmem                  Thêm thành viên chính thức
?mem                     Xem hồ sơ thành viên
?listmem                 Xem danh sách theo chức vụ
?listallmem              Xem toàn bộ thành viên
?locmem                  Lọc thành viên
?checkmem                Kiểm tra người đã rời Discord
?roiguild                Đánh dấu thành viên rời guild
?xoamem                  Xóa thành viên theo quyền
?syncngayvao             Đồng bộ ngày vào guild

?pickrole                Chọn role/vũ khí
?helprole                Xem hướng dẫn sub-role
?listrole                Xem danh sách role
?setrole                 Gán role
?unsetrole               Gỡ role
?show                    Bật hiển thị role
```

Cú pháp chi tiết có thể thay đổi theo từng lệnh. Hãy dùng lệnh help tương ứng hoặc xem phản hồi hướng dẫn của bot khi nhập thiếu tham số.

## 8. Thông báo, lịch guild và nhắc nhở

```text
?thongbao                Tạo thông báo lặp lại
?thongbao1lan            Tạo thông báo một lần
?suathongbao             Sửa thông báo
?huythongbao             Hủy một thông báo
?listthongbao            Xem danh sách thông báo
?xoahetthongbao          Xóa toàn bộ thông báo theo quyền
?thongbaoguild           Gửi thông báo guild
?rolethongbao            Xem/cấu hình giới hạn role thông báo

?nhacnho                 Đăng ký nhận nhắc sự kiện
?bossguild               Tạo party đăng ký Boss Guild
?doilichbossguild        Đổi lịch Boss Guild
?lichboss                Gửi bảng lịch Boss Guild
```

## 9. TTS và voice

### TTS cơ bản

```text
?join                    Bot rảnh tham gia voice của người gọi
?leave                   Rời voice
?stop                    Dừng đọc
.nội dung                Đọc nội dung bằng TTS khi ở cùng voice
```

Bot 2 có prefix mặc định `!`, Bot 3 có prefix mặc định `#`:

```text
!join / !leave / !stop
#join / #leave / #stop
```

Danh sách `TTS_BOT_IDS` và `TTS_BOT_PRIORITY` quyết định bot nào được chọn trước để tránh nhiều bot cùng vào một phòng.

### Voice relay

Lệnh mặc định:

```text
?relay ...               Đại Ngỗng
!relay ...               Tiểu Ngỗng
#relay ...               Chiến Ngỗng
```

Lệnh điều khiển relay yêu cầu Administrator, Manage Guild hoặc Discord ID có trong `VOICE_RELAY_COMMAND_ADMIN_IDS` nếu `VOICE_RELAY_REQUIRE_ADMIN_COMMANDS=true`.

Không bật relay trước khi:

- Ba bot kết nối Supabase thành công.
- Bot 1 mở link server.
- Bot 2/3 kết nối đúng `VOICE_RELAY_LINK_URL`.
- Cả ba dùng chung `VOICE_RELAY_LINK_SECRET`.
- Các bot có quyền View Channel, Connect và Speak.

## 10. EXP và tiện ích cộng đồng

### EXP

```text
?rank                    Xem level và EXP cá nhân
?top                     Xem bảng xếp hạng EXP
```

EXP chat và EXP voice được lưu trong `data/exp.db`.

### Dịch, lựa chọn và chia đội

```text
?dich                    Dịch tin nhắn phía trên sang tiếng Việt
?chon                    Chọn một phương án
?random                  Chọn ngẫu nhiên
?rteam                   Chia đội ngẫu nhiên
?troll                   Tiện ích vui
```

### Bình chọn

```text
?vote                    Tạo bình chọn tùy chỉnh
?voteevent               Bình chọn lịch sự kiện
?votengay                Bình chọn ngày
?votegio                 Bình chọn giờ
?voteboss                Bình chọn Boss Solo
?votepvp                 Bình chọn PvP Solo
?voteyentiec             Bình chọn giờ Yến Tiệc
```

### Album và avatar

```text
?album                   Xem/quản lý album
?setavt                  Đặt avatar tùy chỉnh
?delavt                  Xóa avatar tùy chỉnh
?randomavt               Bật/tắt avatar ngẫu nhiên từ album
?helpphonganh            Xem hướng dẫn phòng ảnh
```

Ảnh được lưu trên Cloudinary, dùng ImgBB làm phương án dự phòng nếu đã cấu hình key.

## 11. Gieo quẻ và cầu duyên

```text
?gieoque                 Gieo quẻ trong ngày
?cauduyen                Xem cầu duyên
?setgieoque              Đặt kênh gieo quẻ chính thức - Admin
?resetque                Reset lượt trong ngày - Admin
```

AI sử dụng Gemini hoặc DeepSeek nếu đã cấu hình API key. Khi API lỗi, một số chức năng có thể dùng nội dung dự phòng.

## 12. Lô tô

```text
?lotohelp                Xem hướng dẫn đầy đủ
?loto                    Bắt đầu/quản lý ván
?lotothem                Thêm người chơi
?lotobo                  Bốc số
?lotocheck               Kiểm tra trạng thái
?lotorollback            Hoàn tác lượt bốc
?lotoend                 Kết thúc ván
?lotoalbum               Xem album/màu thẻ
```

Chỉ người được cấp quyền mới nên điều khiển ván hoặc rollback dữ liệu.

## 13. Booster voice room

```text
?setbooster              Cấu hình role Booster
?setboostcategory        Đặt category chứa phòng
?boostroom               Tạo/mở phòng Booster cá nhân
?delboostroom            Xóa phòng Booster
?addvip                  Thêm người dùng VIP ngoại lệ
?rmvip                   Gỡ VIP ngoại lệ
```

Bot cần quyền Manage Channels, Move Members và Mute Members để vận hành đầy đủ.

## 14. Cài đặt source từ gói đóng gói

### 14.1 Cài bot

Yêu cầu:

- Node.js tương thích với dependency trong `package-lock.json`.
- Filesystem bền vững cho thư mục `data/`.
- Kết nối mạng tới Discord và Supabase.

```bash
npm ci
npm test
```

Tạo file môi trường từ các file mẫu:

```text
.env.example                         → .env
Bot 2 - Tiểu Ngỗng/.env.example      → Bot 2 - Tiểu Ngỗng/.env
Bot 3 - Chiến Ngỗng/.env.example     → Bot 3 - Chiến Ngỗng/.env
```

Không commit ba file `.env`.

Chạy cả ba bot trên host tương thích Pterodactyl:

```bash
bash start.sh
```

`start.sh` hiện dùng `/home/container`. Nếu host khác, chỉnh working directory trước khi chạy.

### 14.2 Cài website

Website hiện dùng cấu trúc Vercel:

- Root route được rewrite vào `WebBangChien/index.html`.
- `/api/*` chạy các Node serverless function trong `api/`.
- Các asset nằm trong `WebBangChien/anh`, `WebBangChien/minigames` và `WebBangChien/nhac`.

Khi triển khai:

1. Import repository/project vào host.
2. Giữ file `vercel.json` nếu dùng Vercel.
3. Nhập biến môi trường cho API.
4. Cập nhật Supabase URL/anon key placeholder trong frontend.
5. Cấu hình Discord OAuth trong Supabase.
6. Thêm domain vào Supabase Redirect URLs.

Host chỉ hỗ trợ static file sẽ không chạy được các API quản lý. Khi đổi sang host khác Vercel, phải port thư mục `api/` sang function/server tương ứng.

## 15. Biến môi trường chính

### Bot 1

```env
token=YOUR_BOT1_TOKEN
clientId=YOUR_BOT1_APPLICATION_ID
PREFIX=?
OWNER_ID=YOUR_OWNER_DISCORD_ID

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SERVICE_KEY

TTS_BOT_IDS=BOT1_ID,BOT2_ID,BOT3_ID
TTS_BOT_PRIORITY=BOT1_ID,BOT2_ID,BOT3_ID
VOICE_RELAY_BOT_USER_IDS=BOT1_ID,BOT2_ID,BOT3_ID

VOICE_RELAY_ENABLED=false
VOICE_RELAY_BOT_ID=1
VOICE_RELAY_GUILD_ID=YOUR_GUILD_ID
VOICE_RELAY_LINK_MODE=server
VOICE_RELAY_LINK_PORT=8790
VOICE_RELAY_LINK_SECRET=YOUR_RANDOM_SHARED_SECRET
```

### Bot 2 và Bot 3

Dùng `.env.example` trong từng thư mục. Mỗi bot cần:

- Token riêng.
- Guild ID.
- Supabase URL và service key.
- Bot ID relay đúng `2` hoặc `3`.
- Link URL trỏ về Bot 1.
- Link secret giống Bot 1.

### API web

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SERVICE_KEY
DISCORD_BOT_TOKEN=YOUR_BOT1_TOKEN
BC_REMINDER_CHANNEL_ID=YOUR_CHANNEL_ID
VOICE_ADMIN_DISCORD_IDS=ADMIN_ID_1,ADMIN_ID_2
```

### Dịch vụ tùy chọn

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
IMGBB_API_KEY=

GEMINI_API_KEY=
GEMINI_API_KEY_1=
DEEPSEEK_API_KEY=
```

Mọi giá trị trong gói phát hành đều là placeholder. Người vận hành phải tạo key/token mới từ tài khoản của mình.

## 16. Dữ liệu cần sao lưu

Không có database thật trong gói source.

Trên host đang chạy, cần sao lưu riêng:

```text
data/users.db
data/exp.db
data/economy.db        # nếu còn dữ liệu legacy
```

Hãy dừng bot trước khi sao lưu toàn bộ thư mục `data/` để tránh database SQLite không nhất quán.

Supabase phải được backup bằng công cụ của Supabase hoặc PostgreSQL. Các bảng chính gồm `bc_users`, `bc_sessions`, `bc_regulars`, `bc_logs`, nhóm tactics và nhóm `voice_relay_*`.

## 17. Xử lý lỗi thường gặp

### Website đăng nhập xong nhưng không vào được

Kiểm tra:

- Discord ID có trong `bc_users`.
- `lang_gia_member=true`.
- Người dùng chưa ở trạng thái rời guild.
- Supabase Discord provider và Redirect URLs đúng domain.

### Web không tải dữ liệu

Kiểm tra:

- `SUPABASE_URL` và anon key frontend.
- RLS policy.
- Bảng/RPC đã tồn tại.
- Browser console có lỗi CDN hoặc Realtime.

### API trả lỗi 500

Kiểm tra environment variables của host web, đặc biệt `SUPABASE_URL` và `SUPABASE_SERVICE_KEY`.

### Bot offline

Kiểm tra:

- Token đúng bot.
- Privileged intents đã bật.
- `npm ci` hoàn tất.
- Node version tương thích.
- Chỉ có một instance dùng token đó.

### Bot online nhưng lệnh không chạy

Kiểm tra prefix, `clientId`, guild allowlist, quyền đọc tin nhắn và Message Content Intent.

### Voice relay không kết nối

Kiểm tra `VOICE_RELAY_ENABLED`, link mode, link URL, port, link secret, Supabase service key và quyền Connect/Speak.

## 18. Bảo mật

- Không gửi token hoặc service key qua Discord.
- Không commit `.env`, database, file backup hoặc credential.
- Supabase service key chỉ được dùng trên bot/API server.
- Anon key frontend phải đi kèm RLS đúng quyền.
- Reset token/webhook ngay nếu từng bị đưa vào chat, log hoặc source công khai.
- Dùng secret vault của host thay vì hardcode key mới vào source.
- Giữ `VOICE_RELAY_ENABLED=false` và `BC_AUTO_CREATE_DISABLED=true` cho đến khi kiểm tra xong hệ thống mới.

## 19. Kiểm tra sau khi cài

- [ ] Website mở bình thường trên desktop và mobile.
- [ ] Đăng nhập Discord thành công.
- [ ] Đọc được `bc_users` và `bc_sessions`.
- [ ] Đăng ký/hủy đăng ký Bang Chiến hoạt động.
- [ ] Team Editor và Tactics đúng quyền.
- [ ] Ba bot online đúng account.
- [ ] `?bc`, `?rank`, `?top` hoạt động.
- [ ] TTS join/leave/stop hoạt động.
- [ ] SQLite tạo được trong `data/`.
- [ ] Supabase Realtime hoạt động.
- [ ] API web không báo thiếu environment variables.
- [ ] Chế độ tự tạo Bang Chiến vẫn tắt.
- [ ] Không có secret thật trong file source hoặc archive phát hành.
