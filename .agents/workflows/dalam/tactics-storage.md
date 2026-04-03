---
description: Workflow triển khai hệ thống Lịch sử + Preset + Đồng bộ Realtime cho Guild War Tactics
---

# Tactics Storage System — Workflow Triển Khai

## Tổng quan
Hệ thống lưu trữ chiến thuật gồm 3 lớp:
- **LIVE** (`bc_tactics`): Chiến thuật đang soạn, ghi đè mỗi lần Lưu, XOÁ khi session end
- **Lịch sử** (`bc_tactics_history`): Snapshot chỉnh sửa (`type=edit`) + thực chiến (`type=battle`)
- **Preset** (`bc_tactics_presets`): Template cá nhân liên kết Discord ID

## Bước 1: Tạo bảng Supabase

### Bảng `bc_tactics_history`
```sql
CREATE TABLE bc_tactics_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id text NOT NULL,
  day text NOT NULL,
  type text NOT NULL CHECK (type IN ('edit', 'battle')),
  saved_at timestamptz DEFAULT now(),
  saved_by text,
  roster jsonb,
  markers jsonb NOT NULL,
  result_note text
);
CREATE INDEX idx_tactics_history_guild_day ON bc_tactics_history(guild_id, day, saved_at DESC);
```

### Bảng `bc_tactics_presets`
```sql
CREATE TABLE bc_tactics_presets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id text NOT NULL,
  discord_id text NOT NULL,
  preset_name text NOT NULL,
  markers jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_tactics_presets_user ON bc_tactics_presets(guild_id, discord_id);
```

## Bước 2: Đồng bộ Roster Realtime (tactics.html)

1. Xoá `fillMockTeams()` — không dùng dữ liệu giả nữa
2. Fetch roster từ `bc_sessions` + `bc_users` (copy logic từ index.html)
3. Subscribe Realtime channel `public:bc_sessions` → auto refresh panel
4. Panel trái (Công 1, Công 2, Thủ, Rừng) = **Readonly**
5. Nếu < 30 người → hiện banner ⚠️ cảnh báo
6. Giữ dữ liệu test (bypass leader mode) nhưng fetch từ DB thay vì mock

## Bước 3: Auto-save lịch sử chỉnh sửa (tactics.html)

1. Trong hàm `saveTactics()`, sau khi upsert vào `bc_tactics`:
   ```js
   // Chèn thêm snapshot lịch sử
   await sb.from('bc_tactics_history').insert({
     guild_id: guildId,
     day: currentDay,
     type: 'edit',
     saved_by: window.currentDiscordId,
     roster: getAllPlayers(),
     markers: tacticsData
   });
   ```
2. Auto-cleanup: giữ tối đa 10 bản edit gần nhất cho mỗi guild_id + day

## Bước 4: Snapshot thực chiến khi bcend (bcend.js + bangchien.js)

1. Trong `bcend.js`, TRƯỚC khi xoá session:
   ```js
   // Fetch chiến thuật cuối cùng
   const { data: tactics } = await sb
     .from('bc_tactics')
     .select('markers')
     .eq('guild_id', guildId)
     .eq('day', sessionDay)
     .single();
   
   // Lưu snapshot thực chiến
   if (tactics?.markers) {
     await sb.from('bc_tactics_history').insert({
       guild_id: guildId,
       day: sessionDay,
       type: 'battle',
       saved_by: message.author.id,
       roster: { attack1, attack2, defense, forest },
       markers: tactics.markers
     });
   }
   
   // XOÁ data LIVE
   await sb.from('bc_tactics').delete()
     .eq('guild_id', guildId)
     .eq('day', sessionDay);
   ```
2. Áp dụng tương tự cho Auto End 23:00 trong `bangchien.js`

## Bước 5: UI Slide Panel lịch sử (tactics.html)

1. Thêm nút `🕐 Lịch sử` vào header
2. Tạo slide panel bên phải với 2 section:
   - 🏆 THỰC CHIẾN: query `type='battle'` ORDER BY saved_at DESC LIMIT 10
   - 📝 CHỈNH SỬA: query `type='edit'` ORDER BY saved_at DESC LIMIT 10
3. Mỗi entry có 2 nút:
   - 👁 Xem: Load preview readonly lên map (không ghi đè data)
   - ♻️ Áp dụng: **Xác nhận trước** → ghi đè chiến thuật hiện tại
4. Khi áp dụng, map lại player theo Discord ID → cảnh báo orphan

## Bước 6: UI Dropdown Preset (tactics.html)

1. Nút `📋 Preset ▼` mở dropdown
2. Fetch presets: `sb.from('bc_tactics_presets').select('*').eq('discord_id', currentDiscordId)`
3. Các hành động:
   - 📂 Load: xác nhận → ghi đè chiến thuật hiện tại bằng preset
   - 💾 Ghi đè: cập nhật preset bằng chiến thuật đang soạn
   - ➕ Lưu mới: nhập tên → insert preset mới
   - 🗑️ Xoá: xác nhận → delete

## Bước 7: Cảnh báo Orphan / Role Drift (tactics.html)

1. Khi load chiến thuật (từ LIVE, lịch sử, hoặc preset):
   - So sánh player IDs trong tactics vs roster hiện tại
   - ID có trong tactics nhưng không trong roster → ⚠️ Orphan
   - ID có nhưng role khác → ℹ️ Role Drift
2. Hiện toast hoặc banner cảnh báo kèm danh sách tên bị ảnh hưởng

## Lưu ý quan trọng
- Mọi nút "Áp dụng" / "Load" đều phải có **confirm dialog** trước khi ghi đè
- Lịch sử edit auto-cleanup 10 bản, battle giữ vĩnh viễn
- Preset là CÁ NHÂN — chỉ Leader thấy preset của mình
- Dung lượng ước tính 3 tháng: ~8MB (1.6% Supabase Free tier)
