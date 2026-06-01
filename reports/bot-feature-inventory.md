# Báo Cáo Inventory Bot Discord

Ngày sinh báo cáo: 00:41:46 2/6/2026

## Tổng Quan

| mục | giá trị |
| --- | --- |
| Runtime/framework | Node.js, discord.js ^14.25.1 |
| Entry point | index.js -> src/bot.js |
| Prefix mặc định | `?` nếu không có `process.env.PREFIX` |
| Slash command scope | Xóa global slash commands, đăng ký guild commands cho ALLOWED_GUILD_ID |
| Giới hạn guild | ALLOWED_GUILD_ID trong src/config/guildAccess.js; bot tự rời guild không được phép |
| File command quét được | 145 |
| Event files quét được | 14 |
| Utils files quét được | 54 |
| CSV chi tiết | reports/bot-command-inventory.csv |

## Tính Năng Bot Đang Có

| category | count | highlights |
| --- | --- | --- |
| Admin/Hệ thống | 9 | ?muteall, ?serverbot, ?checkapi, ?setkc, ?gonah, ?nominigame, ?setchannelanh, ?setlevelup, ... (+1) |
| Album/Ảnh | 2 | auto:album-save, auto:phong-anh-help-reminder |
| Bang Chiến | 22 | ?bangchien, ?xemds, ?listbangchien, ?bcend, ?bcql, ?huybangchien, ?bcswap, ?bcchihuy, ... (+14) |
| Booster voice room | 4 | ?setbooster, ?addvip, ?rmvip, bot:booster-voice-join-leave |
| EXP/Level | 4 | ?rank, ?top, bot:voice-exp-tracker, auto:text-exp |
| Gieo quẻ/Cầu duyên | 4 | ?setgieoque, ?gieoque, ?cauduyen, ?resetque |
| Loto | 9 | ?loto, ?lotocheck, ?lotoend, ?lotorollback, ?lotothem, ?lotobo, ?lotoalbum, ?lotohelp, ... (+1) |
| Minigame/Economy | 45 | ?themtien, ?xoahet, ?add, ?resetplayer, ?reset, ?resetplayer, ?resetallplayer, ?cleardung, ... (+37) |
| NhacLabs license | 14 | ?nl, ?nlhelp, ?nlinfo, ?nllist, ?nlgen, ?nlblock, ?nlpblock, ?nlunblock, ... (+6) |
| Quản lý thành viên/role | 30 | /pickrole, ?tongrole, ?addhelp, ?lenhquanly, ?addmem, ?addid, ?mem, ?randomavt, ... (+22) |
| Reaction role | 1 | auto:reaction-role-add-remove |
| Ready bootstrap | 4 | bot:leave-unauthorized-guilds, bot:register-slash-guild, bot:init-translate-service, bot:init-gieoque-scheduler |
| Role hiển thị | 11 | ?setrole, ?unsetrole, ?addrole, ?editrole, ?delrole, ?delallrole, ?dsrole, ?helprole, ... (+3) |
| Scripts/Tools phụ trợ | 6 | tools/GiaiNenHangLoat.spec, tools/restore_members.js, tools/unzip_all.py, App/Script/_send_temp.py, App/Script/send_to_discord.js, App/Script/send_to_discord.py |
| Supabase/Database | 12 | supabase_cleanup_bc_regular_weekdays.sql, supabase_migrate_bc_dynamic_roster.sql, supabase_migrate_bc_sessions_day_time_unique.sql, supabase_migrate_day.sql, supabase_migrate_feedback.sql, supabase_migrate_secure_bc_regulars.sql, supabase_migrate_secure_editor_policies.sql, supabase_migrate_tactic_sketches.sql, ... (+4) |
| Thông báo/Boss/Lịch | 22 | /huythongbao, /listthongbao, /rolethongbao, /suathongbao, /thongbao, /thongbao1lan, /thongbaoguild, /xoahetthongbao, ... (+14) |
| Ứng dụng tiện ích | 17 | ?dich, ?album, ?random, ?rteam, ?rrteam, ?chon, ?join, ?spam, ... (+9) |
| Web phụ trợ | 12 | WebBangChien/battle_timer.html, WebBangChien/callback.html, WebBangChien/coin-editor.html, WebBangChien/cpopup.css, WebBangChien/cpopup.js, WebBangChien/index.html, WebBangChien/manifest.json, WebBangChien/map_editor.html, ... (+4) |

## Lưu Ý Quan Trọng

- Loader slash command hiện chỉ đọc `src/commands/<folder>/*.js`; file command nằm sâu hơn được đánh dấu helper/unclear nếu không có route prefix.
- `handleCommands.js` đang xóa global slash command rồi đăng ký guild slash command, nên slash command hiển thị nhanh trong guild cấu hình.
- Một số alias prefix bị khai báo trùng theo thứ tự `messageCreate`; nhánh xuất hiện sau được đánh dấu `unclear` trong CSV.
- Các lệnh Booster cũ `?boostroom`, `?delboostroom`, `?setboostcategory` có file triển khai nhưng trong `messageCreate` ghi disabled, thay bằng `?setbooster` và panel.
- Các comment có thể hiển thị mojibake trong terminal cũ; báo cáo được ghi UTF-8, CSV có BOM để Excel đọc tiếng Việt.

## Tất Cả Slash Commands

| category | aliases | description | permissions | implementation | status | notes |
| --- | --- | --- | --- | --- | --- | --- |
| Quản lý thành viên/role | /pickrole | Chọn role cho bản thân (DPS, Healer, Tanker) | Role Quản Lý | src/commands/quanly/pickrole.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /huythongbao | Hủy thông báo | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/huythongbao.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /listthongbao | Xem danh sách thông báo của server | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/listthongbao.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /rolethongbao | Đặt role yêu cầu để sử dụng các lệnh thông báo (Chỉ Owner) | Owner/whitelist | src/commands/thongbao/rolethongbao.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /suathongbao | Sửa thông báo định kỳ | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/suathongbao.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /thongbao | Đặt thông báo lặp lại hàng tuần | Role LangGia/điều kiện guild | src/commands/thongbao/thongbao.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /thongbao1lan | Đặt thông báo một lần vào ngày giờ cụ thể | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/thongbao1lan.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /thongbaoguild | Đặt thông báo nhiệm vụ Guild | Role LangGia/điều kiện guild | src/commands/thongbao/thongbaoguild.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |
| Thông báo/Boss/Lịch | /xoahetthongbao | Xóa tất cả thông báo của server | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/xoahetthongbao.js | active | Được loader slash cấp thư mục trực tiếp đăng ký. |

## Tất Cả Prefix/Text Commands

| category | aliases | description | permissions | implementation | status | notes |
| --- | --- | --- | --- | --- | --- | --- |
| Admin/Hệ thống | ?muteall | MUTE CHECK (Đặt ở đây để chặn TẤT CẢ lệnh trừ muteall) \| ?muteall - Block/unblock ALL commands in channel (luôn cho phép để có thể unmute) | Owner/whitelist | src/commands/admin/muteall.js | active |  |
| Admin/Hệ thống | ?serverbot | Danh sách server bot đang ở (owner only) | Owner/whitelist | src/commands/admin/serverbot.js | active |  |
| Quản lý thành viên/role | ?tongrole | Xem tổng số role trong server (Owner only) | Owner/whitelist | src/commands/quanly/tongrole.js | active |  |
| Quản lý thành viên/role | ?addhelp | Show help | Role Quản Lý | src/commands/quanly/addhelp.js | active |  |
| Quản lý thành viên/role | ?lenhquanly, ?qlcmd, ?admincmd, ?hiddencommands | Danh sách lệnh quản lý | Role Quản Lý | src/commands/quanly/lenhquanly.js | active |  |
| Quản lý thành viên/role | ?addmem | ?addmem @user <position> <uid> <name> [Xnt] | Role Quản Lý | src/commands/quanly/addmem.js | active |  |
| Quản lý thành viên/role | ?addid | ?addid <uid> <name> - Pre-add game data | Role Quản Lý | src/commands/quanly/addid.js | active |  |
| Gieo quẻ/Cầu duyên | ?setgieoque | ?setgieoque (Admin only) | Owner/whitelist | src/commands/gieoque/setgieoque.js | active |  |
| Admin/Hệ thống | ?checkapi | Check Gemini API Status (Admin only) | Owner/whitelist | src/commands/admin/checkapi.js | active |  |
| Admin/Hệ thống | ?setkc | ?setkc <new_name> | Owner/whitelist | src/commands/admin/setkc.js | active |  |
| Role hiển thị | ?setrole | Set sub-role | Owner/whitelist | src/commands/quanly/subrole/setrole.js | active |  |
| Role hiển thị | ?unsetrole, ?xoarole | Remove sub-role | Role Kỳ Cựu | src/commands/quanly/subrole/unsetrole.js | active |  |
| Role hiển thị | ?addrole | Add sub-role (Bang Chủ) | Owner/whitelist | src/commands/quanly/subrole/addrole.js | active |  |
| Role hiển thị | ?editrole, ?doirole | Edit sub-role (Bang Chủ) | Owner/whitelist | src/commands/quanly/subrole/editrole.js | active |  |
| Role hiển thị | ?delrole | Delete sub-role (Bang Chủ) | Owner/whitelist | src/commands/quanly/subrole/delrole.js | active |  |
| Role hiển thị | ?delallrole | Delete ALL sub-roles (Owner only) | Owner/whitelist | src/commands/quanly/subrole/delallrole.js | active |  |
| Role hiển thị | ?dsrole, ?listrole | List sub-roles | Không thấy kiểm tra rõ trong nhánh quét | src/commands/quanly/subrole/listrole.js | active |  |
| Role hiển thị | ?helprole | Help for role system | Không thấy kiểm tra rõ trong nhánh quét | src/commands/quanly/subrole/helprole.js | active |  |
| Role hiển thị | ?role, ?show | Đổi display role | Owner/whitelist | src/commands/quanly/subrole/show.js | active |  |
| Role hiển thị | ?hideicon, ?anicon | Ẩn display icon | Không thấy kiểm tra rõ trong nhánh quét | src/commands/quanly/subrole/hideicon.js | active |  |
| Role hiển thị | ?setroomcaprole | Thiết lập kênh cấp role thông minh | Owner/whitelist | src/commands/quanly/subrole/setroomcaprole.js | active |  |
| Quản lý thành viên/role | ?mem, ?me | Xem thông tin thành viên (quản lý) | Role Quản Lý | src/commands/quanly/mem.js | active |  |
| EXP/Level | ?rank, ?level, ?xp, ?exp | Xem EXP/level cá nhân | Không thấy kiểm tra rõ trong nhánh quét | src/commands/exp/rank.js | active |  |
| EXP/Level | ?top, ?leaderboard, ?lb, ?bxh | Bảng xếp hạng | Role LangGia/điều kiện guild | src/commands/exp/top.js | active |  |
| Quản lý thành viên/role | ?randomavt, ?rda | Random avatar từ album | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/randomavt.js | active |  |
| Ứng dụng tiện ích | ?dich, ?translate, ?dichtiengviet | Dịch tin nhắn phía trên sang tiếng Việt | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/dich.js | active |  |
| Quản lý thành viên/role | ?setavt, ?setavatar, ?avatar, ?avt | Set custom avatar | Role Quản Lý | src/commands/quanly/setavt.js | active |  |
| Quản lý thành viên/role | ?delavt, ?delavatar, ?removeavt, ?removeavatar, ?clearavt | Xóa custom avatar | Không thấy kiểm tra rõ trong nhánh quét | src/commands/quanly/delavt.js | active |  |
| Quản lý thành viên/role | ?clearallavt, ?xoahetatv, ?delavtall | Xóa TẤT CẢ custom avatar (Owner only) | Owner/whitelist | src/commands/quanly/clearallavt.js | active |  |
| Quản lý thành viên/role | ?banavt | ?banavt @user - Ban user không được set avatar (Kỳ Cựu trở lên) | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Quản lý thành viên/role | ?unbanavt | ?unbanavt @user - Gỡ ban avatar cho user | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Quản lý thành viên/role | ?xoabc | Delete Bang Chủ | Role Quản Lý | src/commands/quanly/xoabc.js | active |  |
| Quản lý thành viên/role | ?xoapbc | Delete Phó Bang Chủ | Role Quản Lý | src/commands/quanly/xoapbc.js | active |  |
| Quản lý thành viên/role | ?listmem, ?dsmem, ?dstv | List active members | Role Kỳ Cựu | src/commands/quanly/listmem.js | active |  |
| Quản lý thành viên/role | ?checkmem, ?kiemtramem, ?checkroi | Kiểm tra thành viên đã rời server | Role LangGia/điều kiện guild | src/commands/quanly/checkmem.js | active |  |
| Quản lý thành viên/role | ?listid, ?listcho | List pending IDs from ?addid | Không thấy kiểm tra rõ trong nhánh quét | src/commands/quanly/listid.js | active |  |
| Quản lý thành viên/role | ?listallmem | List ALL members including left | Role Kỳ Cựu | src/commands/quanly/listallmem.js | active |  |
| Quản lý thành viên/role | ?roiguild | ?roiguild @user - Mark member as left | Role Quản Lý | src/commands/quanly/roiguild.js | active |  |
| Quản lý thành viên/role | ?rsrejoin, ?rsrj | Reset rejoin count (Quản Lý only) | Role Quản Lý | src/commands/quanly/rsrejoin.js | active |  |
| Quản lý thành viên/role | ?xoamem | Xóa thành viên khỏi database (BC/PBC/KC) | Role Quản Lý | src/commands/quanly/xoamem.js | active |  |
| Quản lý thành viên/role | ?xoamemngoaiserver, ?donmemngoaiserver, ?cleanmemserver | Dọn thành viên trong database không còn ở server Discord. | Owner/whitelist | src/commands/quanly/xoamemngoaiserver.js | active |  |
| Quản lý thành viên/role | ?locmem | Lọc thành viên có role LangGia nhưng không trong database | Role Quản Lý | src/commands/quanly/locmem.js | active |  |
| Minigame/Economy | ?themtien | Add Hạt to user (Quản Lý only) | Owner/whitelist | src/commands/admin/minigame/themtien.js | active |  |
| Gieo quẻ/Cầu duyên | ?gieoque, ?xinque, ?xq, ?buxu | Gieo quẻ mỗi ngày | Role LangGia/điều kiện guild | src/commands/gieoque/gieoque.js | active |  |
| Gieo quẻ/Cầu duyên | ?cauduyen, ?cd | Cầu duyên (tình yêu) | Role LangGia/điều kiện guild | src/commands/gieoque/cauduyen.js | active |  |
| Minigame/Economy | ?xoahet | Delete all equipment, items and currency (Quản Lý only) | Owner/whitelist | src/events/client/messageCreate.js | unclear | Không resolve được biến handler `xoahetCommand` từ import top-level; cần kiểm tra thủ công. |
| Minigame/Economy | ?add | Add items to user (owner only) | Owner/whitelist | src/commands/admin/minigame/additem.js | active |  |
| Minigame/Economy | ?resetplayer | Reset all minigame data (owner only) | Owner/whitelist | src/commands/admin/minigame/resetplayer.js | active |  |
| Minigame/Economy | ?reset | Reset your own minigame data (owner only) | Owner/whitelist | src/commands/admin/minigame/resetplayer.js | active |  |
| Minigame/Economy | ?resetplayer | ?resetplayer @user - Reset a player's minigame data (owner only) | Owner/whitelist | src/commands/admin/minigame/resetplayer.js | active |  |
| Minigame/Economy | ?resetallplayer | Reset ALL players' minigame data (owner only) | Owner/whitelist | src/commands/admin/minigame/resetallplayer.js | active |  |
| Minigame/Economy | ?cleardung, ?dungclear, ?resetdung | Clear dungeon sessions (owner only) | Owner/whitelist | src/commands/admin/minigame/cleardung.js | active |  |
| Thông báo/Boss/Lịch | ?xoatoanbodanhsachthanhvien | Delete all members (owner only) | Owner/whitelist | src/commands/admin/thongbao/xoatoanbodanhsachthanhvien.js | active |  |
| Admin/Hệ thống | ?gonah | Special message | Không thấy kiểm tra rõ trong nhánh quét | src/commands/admin/gonah.js | active |  |
| Admin/Hệ thống | ?nominigame | Block/unblock minigame in channel | Owner/whitelist | src/commands/admin/nominigame.js | active |  |
| Booster voice room | ?setbooster | [DISABLED] Các lệnh cũ đã thay bằng ?setbooster panel \| ?boostroom / ?br / ?myroom \| ?delboostroom / ?dbr \| ?setboostcategory \| ?setbooster <Category ID> - Thiết lập Booster Panel + category | Owner/whitelist | src/commands/booster/setbooster.js | active |  |
| Booster voice room | ?addvip | Thêm người dùng vào danh sách VIP Booster Room | Owner/whitelist | src/commands/booster/addvip.js | active |  |
| Booster voice room | ?rmvip | Gỡ người dùng khỏi danh sách VIP Booster Room | Owner/whitelist | src/commands/booster/rmvip.js | active |  |
| Admin/Hệ thống | ?setchannelanh, ?setchannelphonganh, ?phonganh | Set channel làm Phòng Ảnh (Quản Lý only) | Admin/quyền Discord | src/commands/admin/setchannelanh.js | active |  |
| Admin/Hệ thống | ?setlevelup, ?setlvup, ?setlvl | Set kênh nhận thông báo Level Up (Quản Lý only) | Admin/quyền Discord | src/commands/admin/setlevelup.js | active |  |
| Ứng dụng tiện ích | ?album, ?xemanh, ?myalbum, ?anh | Xem album ảnh của bạn | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/album.js | active |  |
| Quản lý thành viên/role | ?helpphonganh, ?helppa, ?hdphonganh, ?albumhelp | Hướng dẫn sử dụng Phòng Ảnh | Role Quản Lý | src/commands/quanly/helpphonganh.js | active |  |
| Admin/Hệ thống | ?clearallalbum, ?xoahetalbum, ?delallalbum, ?clearalbum | Xoá TẤT CẢ ảnh trong Album (Owner only) | Owner/whitelist | src/commands/admin/clearallalbum.js | active |  |
| Loto | ?loto, ?lt | Random số lô tô | Owner/whitelist | src/commands/loto/loto.js | active |  |
| Loto | ?lotocheck, ?ltc | Check số đã/chưa đọc | Không thấy kiểm tra rõ trong nhánh quét | src/commands/loto/lotocheck.js | active |  |
| Loto | ?lotoend, ?lte | Kết thúc ván | Không thấy kiểm tra rõ trong nhánh quét | src/commands/loto/lotoend.js | active |  |
| Loto | ?lotorollback, ?ltrb | Rollback ván đã end | Không thấy kiểm tra rõ trong nhánh quét | src/commands/loto/lotorollback.js | active |  |
| Loto | ?lotothem, ?ltt | Thêm số vào sàn | Không thấy kiểm tra rõ trong nhánh quét | src/commands/loto/lotothem.js | active |  |
| Loto | ?lotobo, ?ltb | Bỏ số khỏi sàn | Không thấy kiểm tra rõ trong nhánh quét | src/commands/loto/lotobo.js | active |  |
| Loto | ?lotoalbum, ?lta | Xem album lá Loto | Không thấy kiểm tra rõ trong nhánh quét | src/commands/loto/lotoalbum.js | active |  |
| Loto | ?lotohelp, ?lth | Hướng dẫn chơi Loto | Admin/quyền Discord | src/commands/loto/lotohelp.js | active |  |
| Ứng dụng tiện ích | ?random | APPS COMMANDS \| ?random <min> <max> - Generate random number | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/random.js | active |  |
| Ứng dụng tiện ích | ?rteam, ?rt, ?randomteam | Random chia 2 team | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/rteam.js | active |  |
| Ứng dụng tiện ích | ?rrteam, ?rrt | Random lại kết quả chia đội trước đó | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/rteam.js | active |  |
| Ứng dụng tiện ích | ?chon | ?chon <options> - Random select from options | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/chon.js | active |  |
| Ứng dụng tiện ích | ?join, ?leave, ?stop | TTS Voice commands | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/tts.js | active |  |
| Ứng dụng tiện ích | ?spam | Tạo chủ đề mới để spam lệnh (hoặc tag vào chủ đề cũ) | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Ứng dụng tiện ích | ?vote, ?poll, ?binhchon | Bình chọn tùy chỉnh | Không thấy kiểm tra rõ trong nhánh quét | src/commands/apps/vote.js | active |  |
| Ứng dụng tiện ích | ?voteevent, ?votesukien, ?votelich | Bình chọn lịch sự kiện Guild (legacy) | Owner/whitelist | src/commands/apps/voteevent.js | active |  |
| Ứng dụng tiện ích | ?voteyentiec | Bình chọn giờ Yến Tiệc | Owner/whitelist | src/commands/apps/voteyentiec.js | active |  |
| Thông báo/Boss/Lịch | ?votebosssolo, ?voteboss | Bình chọn lịch Boss Solo | Role Quản Lý | src/commands/apps/votebosssolo.js | active |  |
| Ứng dụng tiện ích | ?votepvpsolo, ?votepvp | Bình chọn lịch PvP Solo | Role Quản Lý | src/commands/apps/votepvpsolo.js | active |  |
| Ứng dụng tiện ích | ?votegioevent, ?votegio | Bình chọn GIỜ sự kiện (legacy) | Role Quản Lý | src/commands/apps/votegioevent.js | active |  |
| Ứng dụng tiện ích | ?votengayevent, ?votengay | Bình chọn NGÀY sự kiện (legacy) | Role Quản Lý | src/commands/apps/votengayevent.js | active |  |
| Thông báo/Boss/Lịch | ?dsdk, ?dsdangky, ?prereg | Xem danh sách đăng ký trước (+1) | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Thông báo/Boss/Lịch | ?bossguild, ?bg, ?dkboss, ?dangkyboss | Bắt đầu thông báo Boss Guild | Role Kỳ Cựu | src/commands/thongbao/bossguild.js | active |  |
| Thông báo/Boss/Lịch | ?lichboss, ?lichguild, ?bosschedule | Gửi embed lịch Boss Guild | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/lichboss.js | active |  |
| Thông báo/Boss/Lịch | ?doilichbossguild, ?doilich, ?editbossschedule | Chỉnh sửa lịch Boss Guild | Admin/quyền Discord | src/commands/thongbao/doilichbossguild.js | active |  |
| Thông báo/Boss/Lịch | ?bgrs, ?bgreset, ?bossguildreset | Reset danh sách đăng ký trước (+1) | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Thông báo/Boss/Lịch | ?lenhbossguild, ?lenhbg, ?lbg | Xem lệnh Boss Guild | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Bang Chiến | ?bangchien, ?bc, ?dangkybangchien | Đăng ký Bang Chiến | Owner/whitelist | src/commands/bangchien/bangchien.js | active |  |
| Bang Chiến | ?xemds | Xem danh sách đăng ký đầy đủ (tạm thời, không bị cắt) | Không thấy kiểm tra rõ trong nhánh quét | src/utils/bangchienState.js | active |  |
| Bang Chiến | ?listbangchien, ?listbc | Xem chi tiết lần bang chiến gần nhất | Role Quản Lý | src/commands/bangchien/listbangchien.js | active |  |
| Bang Chiến | ?bcend, ?ketthucbc, ?endbc | Kết thúc BC (thay thế bcwin/bcthua) | Owner/whitelist | src/commands/bangchien/bcend.js | active |  |
| Bang Chiến | ?bcql, ?bcquanly, ?bangchienquanly | Panel quản lý Bang Chiến (chỉ Leader) | Role Quản Lý | src/commands/bangchien/bcquanly.js | active |  |
| Gieo quẻ/Cầu duyên | ?resetque, ?rsq | Reset lượt gieo quẻ | Owner/whitelist | src/commands/gieoque/resetque.js | active |  |
| Bang Chiến | ?huybangchien, ?huybc | Huỷ phiên đăng ký Bang Chiến | Admin/quyền Discord | src/commands/bangchien/huybangchien.js | active |  |
| Bang Chiến | ?bcswap, ?bcdoi, ?doiteam | Đổi người giữa các team | Role Quản Lý | src/commands/bangchien/bcswap.js | active |  |
| Bang Chiến | ?bcchihuy, ?bcch, ?setchihuy | Đặt chỉ huy | Role Quản Lý | src/commands/bangchien/bcchihuy.js | active |  |
| Bang Chiến | ?bcleader, ?bcld, ?setleader | Đặt leader team | Role Quản Lý | src/commands/bangchien/bcleader.js | active |  |
| Bang Chiến | ?bcadd, ?bcaddmem, ?thembc | Thêm người vào danh sách BC | Role Quản Lý | src/commands/bangchien/bcadd.js | active |  |
| Bang Chiến | ?lenhbangchien, ?lenhbc, ?lbc, ?bchelp, ?helpbc | Xem lệnh bang chiến | Role Quản Lý | src/commands/bangchien/lenhbangchien.js | active |  |
| Bang Chiến | ?bcsize, ?teamsize, ?bcsoluong | Thay đổi số người của các Team BC | Không thấy kiểm tra rõ trong nhánh quét | src/commands/bangchien/bcsize.js | active |  |
| Bang Chiến | ?setbc, ?setbangchien, ?bcchannel | Set kênh BC mặc định | Owner/whitelist | src/commands/bangchien/setbc.js | active |  |
| Bang Chiến | ?bcrole, ?bctanker, ?bcdps, ?bchealer | Xem thành viên theo role | Không thấy kiểm tra rõ trong nhánh quét | src/commands/bangchien/bcrole.js | active |  |
| Bang Chiến | ?chotbc, ?bcchot, ?chotbangchien, ?addbcrole, ?finalize | Thêm role Bang Chiến cho mọi người trong danh sách | Role Quản Lý | src/commands/bangchien/bcchot.js | active |  |
| Bang Chiến | ?tatmic, ?bcmicoff, ?bcmute, ?bcnomic | Tắt mic trong voice BC (giữ mic Leader/Chỉ Huy khi all) | Role Quản Lý | src/commands/bangchien/bcmicoff.js | active |  |
| Bang Chiến | ?momic, ?bcmicon, ?bcmic, ?bcspeak | Bật mic trong voice BC | Role Quản Lý | src/commands/bangchien/bcmicon.js | active |  |
| Bang Chiến | ?bcmicreset, ?resetmic | Reset mic permissions trong voice BC | Role Quản Lý | src/commands/bangchien/bcmicreset.js | active |  |
| Bang Chiến | ?bcmove, ?bcdoi, ?dichuyen | Di chuyển người giữa các team | Role Quản Lý | src/commands/bangchien/bcmove.js | active |  |
| Thông báo/Boss/Lịch | ?nhacnho, ?nn, ?remind | Đăng ký nhận nhắc nhở event | Không thấy kiểm tra rõ trong nhánh quét | src/commands/thongbao/nhacnho.js | active |  |
| Thông báo/Boss/Lịch | ?listthongbao, ?lichguild, ?tgb, ?lichsk | Xem lịch sự kiện guild dạng thời gian biểu | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Minigame/Economy | ?bal, ?balance, ?tien, ?hat | Xem số dư | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/balance.js | active |  |
| Minigame/Economy | ?nhua, ?item, ?vatpham | Xem tất cả vật phẩm | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/nhua.js | active |  |
| Minigame/Economy | ?daily | Nhận thưởng hàng ngày | Owner/whitelist | src/events/client/messageCreate.js | active |  |
| Minigame/Economy | ?weekly | Nhận thưởng hàng tuần | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/daily.js | active |  |
| Minigame/Economy | ?shop, ?cuahang | Hiển thị shop | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/shop.js | active |  |
| Minigame/Economy | ?buy, ?mua | Mua item | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/buy.js | active |  |
| Minigame/Economy | ?sell | Bán item | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/sell.js | active |  |
| Minigame/Economy | ?nv, ?q, ?quest, ?nhiemvu | Nhiệm vụ | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/quest.js | active |  |
| Minigame/Economy | ?info, ?i, ?thongtin | Thông tin người chơi | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/info.js | active |  |
| Minigame/Economy | ?thanhtuu, ?tt, ?achievements, ?ach | Thành tựu | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/achievement.js | active |  |
| Minigame/Economy | ?settitle, ?danhieu | Danh hiệu | Role Quản Lý | src/commands/minigame/title.js | active |  |
| Minigame/Economy | ?box, ?hom | Xem và mở box | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/box.js | active |  |
| Minigame/Economy | ?dismantle, ?phantach | Phân tách đồ tím \| ?dismantleall, ?phantachhet, ?pth - Phân tách hết | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/dismantle.js | active |  |
| Minigame/Economy | ?dismantleall, ?phantachhet, ?pth | Phân tách trang bị. | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/dismantle.js | active |  |
| Minigame/Economy | ?inv, ?inventory, ?tuido, ?kho, ?tui, ?bag | Xem kho đồ | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/inventory.js | active |  |
| Minigame/Economy | ?tune, ?nangcap, ?nc | Tune trang bị | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/tune.js | active |  |
| Minigame/Economy | ?buy, ?b | Mua vật phẩm | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/buy.js | active |  |
| Minigame/Economy | ?equip, ?gan, ?eq | Gắn trang bị | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/equip.js | active |  |
| Minigame/Economy | ?unequip, ?ue, ?go | Gỡ trang bị | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/unequip.js | active |  |
| Minigame/Economy | ?lock | Khóa trang bị | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/lock.js | active |  |
| Minigame/Economy | ?ban | Bán đồ (select menu) | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/ban.js | active |  |
| Minigame/Economy | ?trangbi | Xem trang bị đang mặc | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/equip.js | active |  |
| Minigame/Economy | ?top, ?lb, ?leaderboard, ?bxh | Bảng xếp hạng | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/leaderboard.js | active |  |
| Minigame/Economy | ?dungeon, ?dung, ?bicanh | Hệ thống Dungeon | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/dungeon.js | active |  |
| Minigame/Economy | ?huydung, ?huybicanh, ?roidung | Hủy/Rời dungeon đang chạy | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/dungeon.js | active |  |
| Minigame/Economy | ?item, ?it | Xem chi tiết item hoặc player | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/xem.js | active |  |
| Minigame/Economy | ?xem | Smart command: @user -> info, số -> item | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/xem.js | active |  |
| Minigame/Economy | ?huongdan, ?hd, ?guide | Hướng dẫn chơi | Role LangGia/điều kiện guild | src/commands/minigame/huongdan.js | active |  |
| Minigame/Economy | ?lenh, ?cmd, ?commands | Danh sách lệnh ngắn gọn | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/lenh.js | active |  |
| Minigame/Economy | ?look | Xem thông tin item | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/look.js | active |  |
| Minigame/Economy | ?use, ?u, ?sudung | Sử dụng item | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/use.js | active |  |
| Minigame/Economy | ?daden, ?dd, ?truyen | Chuyển dòng trang bị | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/daden.js | active |  |
| Minigame/Economy | ?update | Xem các cập nhật mới | Không thấy kiểm tra rõ trong nhánh quét | src/commands/minigame/update.js | active |  |
| Minigame/Economy | ?reset, ?resetplayer | Reset player data (Owner only) | Owner/whitelist | src/commands/admin/minigame/resetplayer.js | active |  |
| Minigame/Economy | ?donedung | Force complete dungeon (owner only) | Owner/whitelist | src/commands/admin/minigame/donedung.js | active |  |
| Minigame/Economy | ?addnhuafull | Fill nhựa to max (owner only) | Owner/whitelist | src/commands/admin/minigame/addnhuafull.js | active |  |
| Quản lý thành viên/role | ?pickrole, ?pr | Xử lý pickrole command (alias: pr) | Role Quản Lý | src/commands/quanly/pickrole.js | active |  |
| Reaction role | ?setmessrole, ?delmessrole | Tạo/cập nhật message reaction-role từ role + emoji/ảnh. | Owner/whitelist | src/utils/reactionRoleState.js | active | Hard-coded prefix ?; không dùng process.env.PREFIX. |
| Reaction role | ?setmessrole, ?delmessrole | Xóa mapping reaction-role theo role. | Owner/whitelist | src/utils/reactionRoleState.js | active | Hard-coded prefix ?; không dùng process.env.PREFIX. |
| Booster voice room | ?boostroom, ?br, ?myroom | Lệnh cũ tạo Boost Room, đã thay bằng Booster Panel. | Server Booster/VIP | src/commands/booster/boostroom.js | disabled | Comment trong messageCreate ghi DISABLED; thay bằng ?setbooster + nút panel. |
| Booster voice room | ?delboostroom, ?dbr | Lệnh cũ xóa Boost Room, đã thay bằng Booster Panel. | Server Booster/VIP | src/commands/booster/delboostroom.js | disabled | Comment trong messageCreate ghi DISABLED; thay bằng panel. |
| Booster voice room | ?setboostcategory | Lệnh cũ cấu hình category Boost Room. | Admin/quyền Discord | src/commands/booster/setboostcategory.js | disabled | Comment trong messageCreate ghi DISABLED; ?setbooster thay thế. |

## NhacLabs Commands

| category | aliases | description | permissions | implementation | status | notes |
| --- | --- | --- | --- | --- | --- | --- |
| NhacLabs license | ?nl, ?nllist | Hiển thị danh sách key, tìm kiếm hoặc tạo nhanh khi nhập tier. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlhelp | Hiển thị hướng dẫn NhacLabs. | Mọi người | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlinfo, ?nli | Xem chi tiết một license key. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlgen, ?nlg, ?nlc, ?nlcap, ?nlkey | Tạo license key PRO/UNL. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlblock, ?nlb | Chặn key tạm thời. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlpblock, ?nlpb | Chặn key vĩnh viễn. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlunblock, ?nlul | Mở chặn key. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlremove, ?nlrm | Xóa một máy/hardware ID khỏi key. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nldelete, ?nld | Xóa key. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlcat, ?nlcategory | Đổi danh mục key. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlsales, ?nldoanhthu, ?nldt, ?nlrevenue | Xem doanh thu/key đã bán. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nlup, ?nlupgrade | Upgrade key PRO lên UNL. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |
| NhacLabs license | ?nldeleteall, ?nlda, ?nlxoahet | Xóa toàn bộ key theo flow xác nhận. | Owner/whitelist | src/utils/firebaseLicense.js | active |  |

## Auto Triggers Và Job Nền

| category | command | description | entrypoint | status |
| --- | --- | --- | --- | --- |
| Ready bootstrap | bot:leave-unauthorized-guilds | Rời guild không được phép và dọn slash command ở guild mới. | src/bot.js | active |
| Ready bootstrap | bot:register-slash-guild | Xóa slash command global và đăng ký slash command cho ALLOWED_GUILD_ID. | src/functions/handlers/handleCommands.js | active |
| Ready bootstrap | bot:init-translate-service | Tự động dịch tin nhắn/link/embed trong kênh translate. | src/utils/translateService.js | active |
| Ready bootstrap | bot:init-gieoque-scheduler | Reset/lên lịch gieo quẻ và cầu duyên. | src/utils/gieoqueScheduler.js | active |
| EXP/Level | bot:voice-exp-tracker | Quét voice channel mỗi 60 giây để cộng EXP voice. | src/utils/voiceExpTracker.js | active |
| Thông báo/Boss/Lịch | bot:weekly-scheduler | Gửi lịch boss/hướng dẫn Phòng Ảnh theo tuần. | src/utils/weeklyScheduler.js | active |
| Minigame/Economy | bot:cleanup-exp-periodic | Dọn EXP periodic cũ mỗi giờ. | src/bot.js | active |
| Thông báo/Boss/Lịch | bot:restore-notifications | Restore notification/schedule/vote poll sau restart. | src/bot.js | active |
| Bang Chiến | bot:bc-supabase-realtime | Đồng bộ hai chiều Bang Chiến giữa Supabase web và SQLite/Discord. | src/events/client/ready.js | active |
| Bang Chiến | bot:bc-auto-end | Cleanup và re-schedule auto-end Bang Chiến lúc 23:00 VN. | src/events/client/ready.js | active |
| Quản lý thành viên/role | bot:guild-member-remove | Tự đánh dấu thành viên rời guild, dọn BC/regular, sync Supabase và báo kênh. | src/events/guild/guildMemberRemove.js | active |
| Quản lý thành viên/role | bot:guild-member-update | Sync position/role LangGia, dọn regular, xử lý display role và booster role. | src/events/guild/guildMemberUpdate.js | active |
| Booster voice room | bot:booster-voice-join-leave | Tạo/dọn/điều khiển VIP voice room khi user vào/ra voice. | src/events/client/voiceStateUpdate.js | active |
| Quản lý thành viên/role | bot:welcome-dm | Gửi DM welcome kèm ảnh khi member join guild cấu hình. | src/events/guild/guildMemberAdd.js | active |
| Ứng dụng tiện ích | auto:tts-dot-prefix | Đọc TTS nội dung tin nhắn bắt đầu bằng dấu chấm khi bot đang ở cùng voice. | src/events/client/messageCreate.js:105 | active |
| Ứng dụng tiện ích | auto:tiktok-converter | Tự đổi link TikTok sang tnktok để embed tốt hơn rồi xóa message gốc. | src/events/client/messageCreate.js:150 | active |
| Ứng dụng tiện ích | auto:youtube-converter | Bộ đổi YouTube sang koutube đang bị comment out. | src/events/client/messageCreate.js:197 | disabled |
| Thông báo/Boss/Lịch | auto:boss-preregistration | Nhận +1/xin slot/-1 trong kênh boss để đăng ký/hủy trước hoặc vào party đang mở. | src/events/client/messageCreate.js:232 | active |
| Album/Ảnh | auto:album-save | Tự lưu ảnh gửi vào Phòng Ảnh, upload Cloudinary/ImgBB fallback và xóa khi message bị xóa. | src/events/client/messageCreate.js:378 | active |
| Album/Ảnh | auto:phong-anh-help-reminder | Nhắc hướng dẫn Phòng Ảnh theo inactivity/tuần. | src/events/client/messageCreate.js:422 | active |
| Thông báo/Boss/Lịch | auto:boss-schedule-debounce | Gửi lại schedule embed trong kênh boss bằng debounce. | src/events/client/messageCreate.js:482 | active |
| Bang Chiến | auto:bc-overview-refresh | Refresh overview Bang Chiến khi có hoạt động liên quan. | src/events/client/messageCreate.js:540 | active |
| Loto | auto:loto-channel-cleanup | Khi loto active, xóa tin nhắn không phải lệnh loto/ảnh trong kênh loto. | src/events/client/messageCreate.js:632 | active |
| Quản lý thành viên/role | auto:caprole-message-reaction | Cấp role thông minh qua text/reaction trong phòng cấu hình. | src/utils/caproleHandler.js | active |
| EXP/Level | auto:text-exp | Cộng EXP chat cho tin nhắn thường, cooldown 60s, gán role mốc level. | src/events/client/messageCreate.js:669 | active |
| Reaction role | auto:reaction-role-add-remove | Cấp/gỡ role khi reaction add/remove trên message đã cấu hình. | src/events/messageReactionAdd/reactionRoleAdd.js | active |

## Button/Select/Modal Flows

Bảng dưới đây là nhóm flow; CSV có từng `customId`/pattern đầy đủ để lọc.

| category | count | highlights |
| --- | --- | --- |
| Admin/Hệ thống | 6 | customId:serverbot_*, customId:serverbot_invite_select_{...}, customId:serverbot_invite_select_*, customId:serverbot_next_{...}, customId:serverbot_page, customId:serverbot_prev_{...} |
| Bang Chiến | 92 | customId:bangchien_finalize_{...}, customId:bangchien_finalize_*, customId:bangchien_finalize_*, customId:bangchien_join_{...}, customId:bangchien_join_*, customId:bangchien_join_*, customId:bangchien_kick_{...}, customId:bangchien_kick_*, ... (+84) |
| Booster voice room | 30 | customId:booster_create, customId:booster_create, customId:booster_create, customId:booster_delete, customId:booster_delete, customId:booster_delete, customId:boostvc_*, customId:boostvc_*, ... (+22) |
| Khác/Nội bộ | 88 | customId:addid_cancel_*, customId:addid_cancel_*, customId:addid_confirm_*, customId:addid_confirm_*, customId:addid_rejoin_*, customId:addid_rejoin_*, customId:addid_reset_*, customId:addid_reset_*, ... (+80) |
| Loto | 26 | customId:loto_*, customId:loto_auto_{...}, customId:loto_auto_*, customId:loto_disabled_{...}, customId:loto_draw_{...}, customId:loto_draw_*, customId:loto_kinh_{...}, customId:loto_kinh_{...}, ... (+18) |
| Minigame/Economy | 113 | customId:ach_next_{...}_{...}, customId:ach_prev_{...}_{...}, customId:box10_*, customId:box10_*, customId:boxall_*, customId:boxall_*, customId:buacoop_*, customId:buacoop_0_{...}, ... (+105) |
| Quản lý thành viên/role | 55 | customId:addid_cancel_{...}_{...}, customId:addid_confirm_{...}_{...}, customId:addid_rejoin_{...}_{...}, customId:addid_reset_{...}_{...}, customId:addid_resetcancel_{...}_{...}, customId:album_setavt_{...}_{...}, customId:album_setavt_{...}_{...}, customId:edit_cancel_{...}, ... (+47) |
| Role hiển thị | 2 | customId:show_role_select_{...}, customId:show_role_select_${message.author.id} |
| Thông báo/Boss/Lịch | 32 | customId:boss_*, customId:boss_ai_{...}, customId:boss_cancel_{...}, customId:boss_finalize_{...}, customId:boss_finalize_*, customId:boss_invite_{...}, customId:boss_join_{...}, customId:boss_join_*, ... (+24) |
| Ứng dụng tiện ích | 21 | customId:album_delete_{...}_{...}, customId:album_next_{...}_{...}, customId:album_page_{...}, customId:album_prev_{...}_{...}, customId:votecustom_end, customId:votecustom_select, customId:voteevent_btn_pvp, customId:voteevent_btn_yentiec, ... (+13) |

## Web/Supabase/Scripts Phụ Trợ

| category | command | description | status |
| --- | --- | --- | --- |
| Web phụ trợ | WebBangChien/battle_timer.html | Timer Bang Chiến có mốc cảnh báo, âm thanh, notification. | active |
| Web phụ trợ | WebBangChien/callback.html | Callback xác thực Discord OAuth qua Supabase. | active |
| Web phụ trợ | WebBangChien/coin-editor.html | Công cụ chỉnh coin/tài nguyên web. | active |
| Web phụ trợ | WebBangChien/cpopup.css | CSS popup UI dùng trong web Bang Chiến. | active |
| Web phụ trợ | WebBangChien/cpopup.js | Script popup UI dùng trong web Bang Chiến. | active |
| Web phụ trợ | WebBangChien/index.html | Dashboard Bang Chiến tổng quan, đăng ký/xem đội hình và đồng bộ Supabase. | active |
| Web phụ trợ | WebBangChien/manifest.json | Manifest PWA/web app. | active |
| Web phụ trợ | WebBangChien/map_editor.html | Editor map/marker chiến thuật. | active |
| Web phụ trợ | WebBangChien/tactic_sketch.html | Công cụ vẽ/phác thảo chiến thuật. | active |
| Web phụ trợ | WebBangChien/tactics.html | Bảng chiến thuật/tactics cho Bang Chiến. | active |
| Web phụ trợ | WebBangChien/team_editor.html | Editor đội hình kéo thả, đổi leader, resize team, realtime Supabase. | active |
| Web phụ trợ | WebTimer/index.html | Timer Bang Chiến bản standalone. | active |
| Supabase/Database | supabase_cleanup_bc_regular_weekdays.sql | Cleanup dữ liệu BC regular ngày thường. | active |
| Supabase/Database | supabase_migrate_bc_dynamic_roster.sql | Migration roster động cho Bang Chiến. | active |
| Supabase/Database | supabase_migrate_bc_sessions_day_time_unique.sql | Ràng buộc unique day/time cho session BC. | active |
| Supabase/Database | supabase_migrate_day.sql | Migration cột/ngày cho lịch. | active |
| Supabase/Database | supabase_migrate_feedback.sql | Migration bảng feedback. | active |
| Supabase/Database | supabase_migrate_secure_bc_regulars.sql | RLS/policy danh sách đăng ký định kỳ BC. | active |
| Supabase/Database | supabase_migrate_secure_editor_policies.sql | RLS/policy bảo mật editor. | active |
| Supabase/Database | supabase_migrate_tactic_sketches.sql | Migration tactic sketches. | active |
| Supabase/Database | supabase_migrate_tactics_session.sql | Migration session tactics. | active |
| Supabase/Database | supabase_migrate_team_names.sql | Migration tên team. | active |
| Supabase/Database | supabase_migrate_web_roster_logs.sql | Migration log roster web. | active |
| Supabase/Database | supabase_setup.sql | Schema/setup Supabase chính. | active |
| Scripts/Tools phụ trợ | tools/GiaiNenHangLoat.spec | Script/tool phụ trợ: GiaiNenHangLoat.spec. | helper |
| Scripts/Tools phụ trợ | tools/restore_members.js | Script/tool phụ trợ: restore_members.js. | helper |
| Scripts/Tools phụ trợ | tools/unzip_all.py | Script/tool phụ trợ: unzip_all.py. | helper |
| Scripts/Tools phụ trợ | App/Script/_send_temp.py | Script/tool phụ trợ: _send_temp.py. | helper |
| Scripts/Tools phụ trợ | App/Script/send_to_discord.js | Script/tool phụ trợ: send_to_discord.js. | helper |
| Scripts/Tools phụ trợ | App/Script/send_to_discord.py | Script/tool phụ trợ: send_to_discord.py. | helper |

## Module Command Không Thấy Route Trực Tiếp

Các module này vẫn được quét. Chúng có thể là helper, collector, module disabled, hoặc chỉ được gọi gián tiếp.

| category | command | description | status | notes |
| --- | --- | --- | --- | --- |
| Loto | loto/lotoAnimations.js | Module lotoanimations trong nhóm Loto. | helper | Không thấy route trực tiếp hoặc là helper/module hỗ trợ trong lần quét tĩnh. |
| Loto | loto/lotoState.js | Module lotostate trong nhóm Loto. | helper | Không thấy route trực tiếp hoặc là helper/module hỗ trợ trong lần quét tĩnh. |
| Minigame/Economy | minigame/ddlist.js | Xem danh sách vật phẩm Đá Đen. | helper | Không thấy route trực tiếp hoặc là helper/module hỗ trợ trong lần quét tĩnh. |
| Minigame/Economy | minigame/khacda.js | Module khacda trong nhóm Minigame/Economy. | helper | Không thấy route trực tiếp hoặc là helper/module hỗ trợ trong lần quét tĩnh. |

## Kiểm Tra Bao Phủ

| check | result |
| --- | --- |
| src/commands/**/*.js | 145 file đã đọc |
| Slash command có SlashCommandBuilder | 9 command |
| Prefix branch trong src/events/client/messageCreate.js | 149 nhánh commandName |
| NhacLabs alias/subcommand | 31 lệnh/alias |
| Manual hard-coded/disabled commands | 8 dòng |
| Auto triggers/job nền | 26 dòng |
| Button/select/modal customId patterns | 465 pattern |
| Web/SQL/scripts phụ trợ | 30 file/dòng |
| Module helper/không route trực tiếp | 4 file |
| Alias trùng cần lưu ý | ?resetplayer, ?bcdoi, ?lichguild, ?buy, ?top, ?lb, ?leaderboard, ?bxh, ?item, ?reset, ?resetplayer |
| Mục disabled | ?boostroom, ?br, ?myroom, ?delboostroom, ?dbr, ?setboostcategory, auto:youtube-converter |

## File CSV

CSV dùng đúng schema yêu cầu:

`category, command, type, description, permissions, entrypoint, implementation, options_or_args, status, notes`

Mở `reports/bot-command-inventory.csv` bằng Excel/Google Sheets để lọc theo category, type, status hoặc file implementation.
