---
description: Quy trình đồng bộ Realtime 2 chiều giữa Bot Discord (SQLite) ↔ Supabase ↔ Web Interface
---

# Workflow: Đồng Bộ Realtime Bot ↔ Web

## Tổng quan kiến trúc

```
Bot Discord (SQLite)  ←→  Supabase (PostgreSQL)  ←→  Web Interface (HTML/JS)
         │                       │                          │
    bcMenuHandlers.js       Realtime Channel         setupRealtimeSubscription()
    bcqlHandlers.js          bc_sessions               startPollingFallback()
    supabaseSync.js                                    _cachedSessions
```

## Danh sách Events đã đồng bộ

### ✅ Bot → Web (Bot thay đổi SQLite → sync lên Supabase → Web nhận Realtime)

| Event | File Bot | Hàm Sync | Web Handler |
|-------|----------|----------|-------------|
| Tạo session (`?bc t7`) | `bangchien.js` | `syncBCSession()` | Realtime INSERT → `loadAllSessions()` |
| Kết thúc 1 session (`?bcend t7`) | `bcend.js` | `deleteBCSession()` | **Signal+Delete**: UPDATE status='ended' → web xóa tab, rồi DELETE row |
| Kết thúc tất cả (`?bcend`) | `bcend.js` | `deleteAllBCSessions()` | **Signal+Delete**: UPDATE status='ended' → web xóa tabs, rồi DELETE rows |
| Auto-end 23:00 | `bangchien.js` | `deleteBCSession()` | **Signal+Delete** tương tự |
| Join/Leave/Toggle (menu) | `bcMenuHandlers.js` | `syncSessionToSupabase()` | Realtime UPDATE → `renderTeams()` |
| Kick/Swap/Add (quản lý) | `bcqlHandlers.js` | `syncSessionToSupabase()` | Realtime UPDATE → `renderTeams()` |
| Set leader/Resize | `bcqlHandlers.js` | `syncSessionToSupabase()` | Realtime UPDATE → `renderTeams()` |
| Pickrole (button `?pr`) | `pickroleHandlers.js` | `formatActiveSession()` + `syncBCSession()` + `createOverviewEmbed(guild)` | Realtime UPDATE → debounced `renderTeams()` + overview embed refresh |
| Pickrole (slash `/pickrole`) | `pickrole.js` | `formatActiveSession()` + `syncBCSession()` + `createOverviewEmbed(guild)` | Realtime UPDATE → debounced `renderTeams()` + overview embed refresh |

### ✅ Web → Bot (Web thay đổi Supabase → Bot nhận qua Polling/Realtime)

| Event | File Web | Cách thức | Bot Handler |
|-------|----------|-----------|-------------|
| Tạo session (nút +) | `index.html` → `createCustomBc()` | Supabase upsert | `ready.js` INSERT handler |
| Xóa session (nút ✕) | `index.html` → `deleteSession()` | Supabase delete | `ready.js` polling / Realtime DELETE |
| Join BC (nút Đăng ký) | `index.html` → `joinBC()` | Supabase update | Bot polling 8s phát hiện |
| Leave BC (nút Hủy đăng ký) | `index.html` → `leaveBC()` | Supabase update | Bot polling 8s phát hiện |
| Kéo thả map positions | `index.html` → map handlers | Supabase update | Bot polling 8s |

## Cách Thêm Event Mới

### Từ Bot → Web

1. **Trong file handler bot** (ví dụ `bcqlHandlers.js`):
   ```javascript
   // Sau khi thay đổi SQLite xong
   const { syncBCSession, formatActiveSession } = require('./supabaseSync');
   const session = db.getActiveBangchienByDay(guildId, day); 
   const formatted = formatActiveSession(session, db, guild); // guild param cho role enrichment
   if (formatted) await syncBCSession(guildId, day, formatted);
   ```

2. **Web sẽ tự nhận** qua Realtime subscription (UPDATE event) trong `setupRealtimeSubscription()`.

3. **Nếu là DELETE** (dùng chiến lược **Signal+Delete**):
   ```javascript
   const { deleteBCSession } = require('./supabaseSync');
   await deleteBCSession(guildId, day);
   // Hàm này sẽ: UPDATE status='ended' → chờ 500ms → DELETE row
   // Web nhận UPDATE event với status='ended' → tự xóa tab
   ```

### Từ Web → Bot

1. **Trong file `index.html`**: Cập nhật trực tiếp vào Supabase qua `sb.from('bc_sessions').update(...)`.

2. **Bot sẽ tự nhận** qua polling fallback mỗi 8 giây trong `supabaseSync.js`.

## Cơ chế Fallback

### Web fallback (khi Realtime TIMED_OUT)
- File: `web/index.html` → `startPollingFallback()`
- Tần suất: mỗi 3 giây
- Thuật toán: So sánh `_cachedSessions` từng session, chỉ render tab đang xem nếu data đổi
- Debounce: UPDATE render gộp 300ms (nhiều update liên tiếp → chỉ render 1 lần)

### Bot fallback (khi Realtime TIMED_OUT)
- File: `src/utils/supabaseSync.js`
- Tần suất: mỗi 8 giây
- Thuật toán: Query `bc_sessions` từ Supabase, so sánh với SQLite, reconcile

## Lưu ý quan trọng

1. **Luôn gọi sync SAU KHI SQLite đã thay đổi** — không gọi trước khi commit.
2. **Dùng `formatActiveSession(session, db, guild)`** để chuyển đổi SQLite row → Supabase format. Param `guild` (Discord Guild object) cho phép enrich player role data (DPS/Healer/Tanker + sub-type).
3. **`leader_ids`**: Khi web tạo session, truyền `{ creator_id, creator_name }` trong `leader_ids` để bot đọc tên người tạo.
4. **loadAllSessions() giữ tab**: Hàm này tự ghi nhớ `previousDay` và activate lại tab cũ sau khi rebuild.
5. **Signal+Delete cho xóa session**: Supabase free tier KHÔNG gửi DELETE event qua Realtime (Replica Identity DEFAULT). Workaround: UPDATE `status='ended'` trước (web nhận UPDATE event) → chờ 500ms → DELETE row. Web detect `status='ended'` → xóa tab.
6. **Tạo session từ web**: Tự động thêm người tạo vào Team Công 1 và gửi `creator_name` trong `leader_ids`.
7. **Pickrole sync**: Khi user dùng `?pr`, dù SQLite team data không đổi, enriched data (role/sub) sẽ khác → Supabase upsert sẽ trigger UPDATE event → web polling phát hiện.
8. **Supabase Realtime thường TIMED_OUT** trên free tier → cả bot lẫn web đều dùng polling fallback. Delay tệ nhất: ~3-5 giây.
9. **Reconcile khi bot khởi động**: `syncAllActiveSessions()` sẽ query Supabase TRƯỚC để tìm session đã bị web xoá trong lúc bot offline (zombie session). Nếu phát hiện, sẽ xoá khỏi SQLite + xoá role BC cho members trước khi push các session còn lại lên Supabase.
