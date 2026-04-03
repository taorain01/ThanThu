---
description: Xây dựng hệ thống "Chỉnh Sửa Đội Hình" trên web với đồng bộ realtime 2 chiều Discord ↔ Supabase ↔ Web
---

# Workflow: Team Editor — Chỉnh Sửa Đội Hình Web + Discord Sync

## Tổng quan kiến trúc

```
Web Team Editor (team_editor.html)
  ↕ Supabase UPDATE bc_sessions
Bot Discord (SQLite) ←→ Supabase (PostgreSQL) ←→ Web Index (index.html)
```

Mọi thay đổi đội hình từ web → Supabase → Bot polling 8s → SQLite → Discord embeds.
Mọi thay đổi từ Discord → SQLite → Supabase sync → Web realtime/polling 3s.

---

## PHASE 1: Supabase Schema — Thêm bảng + field mới

### 1.1. Thêm field `locked` vào `bc_sessions`

Chạy SQL trong Supabase SQL Editor:

```sql
-- Thêm field locked cho chốt danh sách
ALTER TABLE bc_sessions ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false;
```

### 1.2. Tạo bảng `bc_regulars` (Luôn tham gia)

```sql
-- Bảng lưu danh sách "Luôn tham gia" — sync 2 chiều bot ↔ web
CREATE TABLE IF NOT EXISTS bc_regulars (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    username TEXT,
    day TEXT NOT NULL CHECK (day IN ('sat', 'sun')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, discord_id, day)
);

-- RLS
ALTER TABLE bc_regulars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read bc_regulars"
    ON bc_regulars FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert bc_regulars"
    ON bc_regulars FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update bc_regulars"
    ON bc_regulars FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete bc_regulars"
    ON bc_regulars FOR DELETE TO authenticated USING (true);

CREATE POLICY "Service role can do everything on bc_regulars"
    ON bc_regulars FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE bc_regulars;
```

### 1.3. Cập nhật `supabase_setup.sql`

Thêm 2 đoạn SQL ở trên vào cuối file `supabase_setup.sql` để lưu lại schema.

---

## PHASE 2: Bot Discord — Sửa `?listbc` hiển thị tất cả ngày

### 2.1. File: `src/commands/bangchien/listbangchien.js`

**CASE 2 (`?listbc` không tham số):** Hiện tại chỉ hiện T7 + CN.

Thay đổi:
- Query TẤT CẢ sessions active (`db.getActiveBangchienByGuild(guildId)`)
- Render embed field cho MỖI session (không chỉ T7/CN)
- Tạo buttons cho MỖI ngày có session active (tối đa 5 nút vì Discord giới hạn)
- Sắp xếp theo DAY_ORDER: mon → tue → wed → thu → fri → sat → sun

**Logic cụ thể cho CASE 2:**
```javascript
// Lấy TẤT CẢ sessions active (thay vì chỉ sat + sun)
const allSessions = db.getActiveBangchienByGuild(guildId);
const dayOrder = ['mon','tue','wed','thu','fri','sat','sun'];
allSessions.sort((a,b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));

// Render field cho từng session
for (const session of allSessions) {
    const stats = getStats(session);
    const dateStr = getDayNameWithDate(session.day).toUpperCase();
    let line = `📅 **${dateStr}** (${stats.total}/30) - Đang diễn ra\n⚔️ Công: ${stats.attack}`;
    // ... thêm Thủ, Rừng nếu size > 0
    embed.addFields({ name: '\u200b', value: line, inline: false });
}

// Buttons: mỗi ngày 1 nút (tối đa 5)
const row = new ActionRowBuilder();
for (const session of allSessions.slice(0, 5)) {
    const shortLabel = dayShortLabels[session.day] || session.day;
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`listbc_view_${session.day}_${guildId}`)
            .setLabel(`📋 ${shortLabel}`)
            .setStyle(ButtonStyle.Primary)
    );
}
```

**Nút Set Leader:** Đổi từ `ButtonStyle.Secondary` → `ButtonStyle.Primary`

Dòng ~362 trong `listbangchien.js`:
```javascript
// CŨ:
.setStyle(ButtonStyle.Secondary)
// MỚI:
.setStyle(ButtonStyle.Primary)
```

### 2.2. File: `src/events/client/interactionCreate.js`

Kiểm tra handler cho `listbc_view_` có parse day đúng không. Hiện tại format:
`listbc_view_sat_GUILDID` → parse `sat` từ parts[2].

Cần đảm bảo parse đúng cho tất cả ngày (mon, tue, wed, ...), không chỉ sat/sun.
Logic hiện tại dùng `parts[2]` → OK cho tất cả ngày, không cần sửa.

---

## PHASE 3: Bot Discord — Nút "Luôn tham gia" chỉ T7/CN

### 3.1. File: `src/commands/bangchien/bangchien.js`

Hàm `createBangchienButtons(partyKey)` (dòng ~233):

Thay đổi: Thêm param `day` → chỉ hiện nút "🔄 Luôn tham gia" khi `day === 'sat' || day === 'sun'`

```javascript
function createBangchienButtons(partyKey, day = null) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_join_${partyKey}`)
                .setLabel('✅ Tham gia')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`bangchien_leave_${partyKey}`)
                .setLabel('❌ Hủy đăng ký')
                .setStyle(ButtonStyle.Secondary)
        );

    // Chỉ hiện "Luôn tham gia" cho T7 và CN (ngày cố định)
    const isPrimary = day === 'sat' || day === 'sun';
    if (isPrimary) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`bangchien_regular_${partyKey}`)
                .setLabel('🔄 Luôn tham gia')
                .setStyle(ButtonStyle.Primary)
        );
    }

    return row;
}
```

Cập nhật tất cả chỗ gọi `createBangchienButtons()` để truyền thêm `day`.

### 3.2. File: `src/utils/bcMenuHandlers.js`

Hàm `createBcMenu()` (dòng ~47):

- Chỉ hiện nút `🔄 Luôn T7` / `🔄 Luôn CN` khi `DAY_CONFIG[day].primary === true`
- Các ngày custom (T2-T6) chỉ có nút Tham gia / Hủy

```javascript
// Trong vòng lặp for (const day of daysToShow)
// Dòng ~109, thêm điều kiện:
const isPrimaryDay = DAY_CONFIG[day]?.primary === true;
if (isPrimaryDay) {
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`bcmenu_regular_${day}_${guildId}`)
            .setLabel(isRegularDay ? `🔄 Bỏ luôn ${shortLabel}` : `🔄 Luôn ${shortLabel}`)
            .setStyle(isRegularDay ? ButtonStyle.Secondary : ButtonStyle.Primary)
    );
}
```

### 3.3. File: `src/utils/supabaseSync.js` — Thêm sync bc_regulars

Thêm 2 hàm mới:

```javascript
/**
 * Sync 1 record "Luôn tham gia" lên Supabase
 * Gọi khi user bấm "Luôn TG" trên Discord
 */
async function syncBcRegular(guildId, discordId, username, day) {
    if (!isReady()) return;
    try {
        await supabase.from('bc_regulars').upsert({
            guild_id: guildId,
            discord_id: discordId,
            username: username,
            day: day
        }, { onConflict: 'guild_id,discord_id,day' });
        console.log(`[supaSync] ✅ Synced bc_regular: ${username} → ${day}`);
    } catch (e) {
        console.error('[supaSync] Lỗi sync bc_regular:', e.message);
    }
}

/**
 * Xóa 1 record "Luôn tham gia" trên Supabase
 * Gọi khi user tắt "Luôn TG" hoặc bị kick
 */
async function removeBcRegular(guildId, discordId, day) {
    if (!isReady()) return;
    try {
        await supabase.from('bc_regulars')
            .delete()
            .eq('guild_id', guildId)
            .eq('discord_id', discordId)
            .eq('day', day);
        console.log(`[supaSync] ✅ Removed bc_regular: ${discordId} → ${day}`);
    } catch (e) {
        console.error('[supaSync] Lỗi remove bc_regular:', e.message);
    }
}
```

Export 2 hàm mới và gọi chúng trong:
- `bcMenuHandlers.js` — khi toggle "Luôn tham gia" (dòng ~218, ~251, ~478, ~517)
- `bcqlHandlers.js` — khi kick user (dòng ~514)

### 3.4. Bot Polling — Sync bc_regulars từ Supabase → SQLite

Trong `supabaseSync.js`, thêm vào hàm polling (chạy mỗi 8s):

```javascript
// Sync bc_regulars từ Supabase → SQLite (web → bot)
async function pollBcRegulars(guildId) {
    if (!isReady()) return;
    try {
        const { data } = await supabase.from('bc_regulars')
            .select('*')
            .eq('guild_id', guildId);
        if (!data) return;

        // So sánh với SQLite, thêm/xóa cho đồng bộ
        for (const day of ['sat', 'sun']) {
            const supaRegulars = data.filter(r => r.day === day);
            const sqliteRegulars = db.getBcRegulars(guildId, day);

            // Thêm từ Supabase nếu SQLite chưa có
            for (const sr of supaRegulars) {
                if (!sqliteRegulars.some(r => r.discord_id === sr.discord_id)) {
                    db.addBcRegular(guildId, sr.discord_id, sr.username, day);
                    console.log(`[supaSync] ← Web added regular: ${sr.username} → ${day}`);
                }
            }

            // Xóa khỏi SQLite nếu Supabase không còn
            for (const sr of sqliteRegulars) {
                if (!supaRegulars.some(r => r.discord_id === sr.discord_id)) {
                    db.removeBcRegular(guildId, sr.discord_id, day);
                    console.log(`[supaSync] ← Web removed regular: ${sr.username} → ${day}`);
                }
            }
        }
    } catch (e) {
        console.error('[supaSync] Lỗi poll bc_regulars:', e.message);
    }
}
```

---

## PHASE 4: Bot Discord — Kick → Hàng chờ + Chốt DS

### 4.1. File: `src/utils/bcqlHandlers.js` — Sửa KICK

Dòng ~504 (KICK SELECT handler):

**CŨ:** `db.removeBangchienParticipant(partyKey, userId)` → xóa hẳn
**MỚI:** Đưa xuống waiting_list

```javascript
// ========== KICK SELECT (ĐƯA XUỐNG HÀNG CHỜ) ==========
if (customId.startsWith('bcql_kick_select_')) {
    const selectedIds = interaction.values;
    let kicked = 0;

    // Lấy session mới nhất
    const freshSession = db.getActiveBangchien(partyKey);
    if (!freshSession) {
        await interaction.update({ content: '❌ BC không tồn tại!', components: [] });
        return true;
    }

    const teams = {
        attack1: [...(freshSession.team_attack1 || [])],
        attack2: [...(freshSession.team_attack2 || [])],
        defense: [...(freshSession.team_defense || [])],
        forest: [...(freshSession.team_forest || [])],
        waiting: [...(freshSession.waiting_list || [])]
    };

    for (const userId of selectedIds) {
        // Tìm người trong các team (không phải waiting)
        let found = false;
        for (const teamKey of ['attack1', 'attack2', 'defense', 'forest']) {
            const idx = teams[teamKey].findIndex(p => p.id === userId);
            if (idx !== -1) {
                const person = teams[teamKey].splice(idx, 1)[0];
                teams.waiting.push(person); // Đưa xuống hàng chờ
                found = true;
                kicked++;
                break;
            }
        }
        // Nếu đã ở waiting → skip
        if (!found) {
            const waitIdx = teams.waiting.findIndex(p => p.id === userId);
            if (waitIdx !== -1) kicked++; // Đếm nhưng không move
        }

        // Xóa "Luôn tham gia" cho user bị kick
        const sessionDay = day || 'sat';
        db.removeBcRegular(guildId, userId, sessionDay);

        // Sync xóa Luôn TG lên Supabase
        try {
            const supaSync = require('./supabaseSync');
            await supaSync.removeBcRegular(guildId, userId, sessionDay);
        } catch(e) {}
    }

    // KHÔNG xóa role BC (vì vẫn ở trong session → hàng chờ)

    // Update DB
    db.updateActiveBangchien(partyKey, {
        team_attack1: teams.attack1,
        team_attack2: teams.attack2,
        team_defense: teams.defense,
        team_forest: teams.forest,
        waiting_list: teams.waiting
    });

    await refreshOverviewEmbed(interaction.client, guildId);
    await syncSessionToSupabase(guildId, partyKey);
    await interaction.update({ content: `✅ Đã đưa ${kicked} người xuống hàng chờ!`, components: [] });

    if (day) await refreshListbcEmbed(interaction, session, day);
    return true;
}
```

### 4.2. File: `src/utils/bcqlHandlers.js` — Thêm xử lý Chốt DS (locked)

Sửa handler `bcql_finalize_` (dòng ~199):

```javascript
// ========== NÚT CHỐT DS ==========
if (customId.startsWith('bcql_finalize_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Đặt locked = true trên Supabase
    try {
        const supaSync = require('./supabaseSync');
        if (supaSync.isReady()) {
            const { createClient } = require('@supabase/supabase-js');
            // Hoặc dùng supabase client có sẵn
            await supaSync.setSessionLocked(guildId, day || 'sat', true);
        }
    } catch(e) {}

    // Giữ nguyên logic tạo embed chốt DS (dòng 202-300)
    // ... (giữ nguyên code tạo embed)

    // Thêm thông báo đã chốt
    await interaction.editReply({
        content: `🔒 Đã chốt danh sách! (${total} người)\n💡 Mọi người vẫn có thể đăng ký nhưng sẽ vào hàng chờ.\n🔓 Dùng web Team Editor để mở khoá.`
    });
    return true;
}
```

### 4.3. File: `src/utils/bcqlHandlers.js` — Resize sync team_sizes lên Supabase

Sau khi save team sizes vào SQLite (dòng ~918-922), thêm:

```javascript
// Sync team_sizes lên Supabase để web đọc
try {
    const supaSync = require('./supabaseSync');
    if (supaSync.isReady()) {
        // Người trong team bị resize về 0 → đưa xuống waiting
        // Logic di chuyển người sẽ nằm trong hàm resize riêng
    }
    await syncSessionToSupabase(guildId, partyKey, interaction.guild);
} catch(e) {}
```

**Quan trọng:** Khi resize team về 0, người trong team đó phải được di chuyển xuống waiting_list TRƯỚC khi save.

---

## PHASE 5: Web Index — Nút "Chỉnh Sửa Đội Hình" + Dynamic Render

### 5.1. File: `web/index.html` — Thêm nút cạnh "Lập Chiến Thuật"

Dòng ~540, thêm SAU nút btnTactics:

```html
<button class="map-toggle tactics-btn" id="btnTeamEditor" data-day="" disabled
    onclick="openTeamEditor()"
    style="margin-left:8px; z-index:10; font-size:12px; padding:6px 14px;
           border-radius:20px; height:max-content; margin-bottom:5px;
           border-color:var(--green-600);
           background:linear-gradient(135deg,rgba(34,197,94,.15),rgba(74,222,128,.1));
           color:var(--green-300);">
    ✏️ Chỉnh Sửa Đội Hình
</button>
```

Chỉ hiện cho user có quyền Leader:
```javascript
// Trong checkAuth(), sau khi set currentUserPosition:
const canEdit = ['kc','pbc','bc','Kỳ Cựu','Quản Lý'].includes(window.currentUserPosition);
document.getElementById('btnTeamEditor').style.display = canEdit ? '' : 'none';
```

### 5.2. File: `web/index.html` — Hàm openTeamEditor()

```javascript
function openTeamEditor() {
    const day = document.getElementById('btnTeamEditor')?.dataset.day || currentDay;
    if (!day) return;
    const sessionParam = currentSessionData?.id
        ? `&session=${encodeURIComponent(currentSessionData.id)}` : '';
    const url = `./team_editor.html?day=${encodeURIComponent(day)}${sessionParam}&ts=${Date.now()}`;

    // Transition animation (giống openTactics)
    let overlay = document.querySelector('.page-transition');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'page-transition';
        overlay.innerHTML = '<div class="pt-content"><span class="pt-icon">✏️</span><div class="pt-text">Đang mở Đội Hình...</div></div>';
        document.body.appendChild(overlay);
    } else {
        overlay.querySelector('.pt-icon').textContent = '✏️';
        overlay.querySelector('.pt-text').textContent = 'Đang mở Đội Hình...';
    }
    requestAnimationFrame(() => {
        overlay.classList.add('active');
        setTimeout(() => { window.location.href = url; }, 600);
    });
}
```

Cập nhật `updateTacticsButtonTarget()` để cũng set day cho btnTeamEditor.

### 5.3. File: `web/index.html` — Dynamic render theo team_sizes (ẩn team size=0)

Trong hàm `renderTeams()` (dòng ~1079):

```javascript
// Đọc team_sizes
const sizes = typeof data.team_sizes === 'string'
    ? JSON.parse(data.team_sizes || '{}') : (data.team_sizes || {});

// Cập nhật max cho các team
if (sizes.attack1) teams[0].max = sizes.attack1;
if (sizes.attack2 !== undefined) teams[1].max = sizes.attack2;
if (sizes.defense !== undefined) teams[2].max = sizes.defense;
if (sizes.forest !== undefined) teams[3].max = sizes.forest;

// Lọc: ẩn team có max = 0
const visibleTeams = teams.filter(t => t.key === 'waiting_list' || t.max > 0);

// Nếu chỉ còn 1 team công, đổi title
const attackTeams = visibleTeams.filter(t => t.key.startsWith('team_attack'));
if (attackTeams.length === 1) {
    attackTeams[0].title = 'TEAM CÔNG';
    // Merge max: attack1.max + attack2.max (nếu 1 cái bị 0)
    attackTeams[0].max = (sizes.attack1 || 0) + (sizes.attack2 || 0);
}

// Render chỉ visibleTeams thay vì tất cả teams
```

### 5.4. File: `web/index.html` — Hiển thị trạng thái locked

Trong `renderTeams()` hoặc `updateSignupBar()`:

```javascript
// Kiểm tra locked
const isLocked = data.locked === true;
if (isLocked) {
    // Thêm badge "🔒 ĐÃ CHỐT" vào header hoặc left panel
    // Signup bar chỉ hiện "Đăng ký (vào hàng chờ)" thay vì "Đăng ký"
}
```

Khi đã chốt + user đăng ký → luôn vào waiting_list (không vào team chính).

---

## PHASE 6: Web Team Editor — Trang mới `team_editor.html`

### 6.1. Cấu trúc HTML

```
team_editor.html
├── Header: Tên ngày + nút ← Quay lại index
├── Toolbar: [📏 Resize] [📋 Chốt DS / 🔓 Huỷ chốt] [🔄 Luôn TG (T7/CN)] [trạng thái 🔒/🔓]
├── Main content (grid 2 cột):
│   ├── Cột trái: 4 team cards (có thể ẩn theo size=0)
│   │   ├── Team Công 1: danh sách + dấu X từng người + drag handle
│   │   ├── Team Công 2: tương tự
│   │   ├── Team Thủ: tương tự
│   │   └── Team Rừng: tương tự
│   └── Cột phải: Hàng chờ + nút ⬆️ đưa lên team
└── Footer: trạng thái sync + thời gian cập nhật cuối
```

### 6.2. Supabase Init + Auth

Copy từ index.html: Supabase client, checkAuth, GUILD_ID.
Đọc `?day=xxx` từ URL params.
Fetch session data ban đầu + subscribe realtime.

### 6.3. Render Teams

Giống `renderTeams()` trong index.html nhưng thêm:
- **Dấu X** bên mỗi người (trừ leader): `<span class="kick-x" onclick="kickToWaiting('userId')">✕</span>`
- **Drag handle**: `<span class="drag-handle">⠿</span>` + `draggable="true"`
- **Leader badge**: Sáng hơn, nổi bật → click để toggle leader

### 6.4. Kick → Hàng chờ (dấu X)

```javascript
async function kickToWaiting(userId) {
    // Xác nhận
    if (!confirm(`Đưa người này xuống hàng chờ?`)) return;

    // Parse teams từ session data
    const data = currentSessionData;
    const parseTeam = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
    let t1 = parseTeam(data.team_attack1);
    let t2 = parseTeam(data.team_attack2);
    let td = parseTeam(data.team_defense);
    let tf = parseTeam(data.team_forest);
    let wl = parseTeam(data.waiting_list);

    // Tìm và di chuyển
    let person = null;
    for (const [team, arr] of [['t1',t1],['t2',t2],['td',td],['tf',tf]]) {
        const idx = arr.findIndex(p => p.id === userId);
        if (idx !== -1) {
            person = arr.splice(idx, 1)[0];
            break;
        }
    }
    if (!person) return;
    wl.push(person);

    // Update Supabase
    await sb.from('bc_sessions').update({
        team_attack1: JSON.stringify(t1),
        team_attack2: JSON.stringify(t2),
        team_defense: JSON.stringify(td),
        team_forest: JSON.stringify(tf),
        waiting_list: JSON.stringify(wl)
    }).eq('guild_id', GUILD_ID).eq('day', currentDay);

    // Xóa "Luôn tham gia" nếu có
    await sb.from('bc_regulars').delete()
        .eq('guild_id', GUILD_ID)
        .eq('discord_id', userId)
        .eq('day', currentDay);
}
```

### 6.5. Drag-and-Drop (HTML5 API)

```javascript
let pendingChanges = null;
let debounceTimer = null;

function setupDragDrop() {
    document.querySelectorAll('.m-row[draggable]').forEach(row => {
        row.addEventListener('dragstart', onDragStart);
        row.addEventListener('dragend', onDragEnd);
    });

    document.querySelectorAll('.team-card, .waiting-card').forEach(zone => {
        zone.addEventListener('dragover', onDragOver);
        zone.addEventListener('dragleave', onDragLeave);
        zone.addEventListener('drop', onDrop);
    });
}

function onDragStart(e) {
    e.dataTransfer.setData('text/plain', JSON.stringify({
        userId: e.target.dataset.userId,
        fromTeam: e.target.dataset.team,
        fromIndex: e.target.dataset.index
    }));
    e.target.classList.add('dragging');
}

function onDrop(e) {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    const toTeam = e.currentTarget.dataset.team;

    // Thực hiện swap/move trong memory
    executeMove(data.userId, data.fromTeam, toTeam);

    // Gom thao tác: debounce 2 giây trước khi gửi Supabase
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        syncToSupabase(); // Gửi 1 lần duy nhất
    }, 2000);

    // Optimistic UI: render ngay (từ data local)
    renderTeamsLocal();
}

async function syncToSupabase() {
    // Gửi toàn bộ teams state hiện tại lên Supabase
    await sb.from('bc_sessions').update({
        team_attack1: JSON.stringify(localTeams.attack1),
        team_attack2: JSON.stringify(localTeams.attack2),
        team_defense: JSON.stringify(localTeams.defense),
        team_forest: JSON.stringify(localTeams.forest),
        waiting_list: JSON.stringify(localTeams.waiting)
    }).eq('guild_id', GUILD_ID).eq('day', currentDay);
    console.log('[TeamEditor] ✅ Synced to Supabase (debounced)');
}
```

### 6.6. Resize Modal

```javascript
async function openResizeModal() {
    // Hiện modal với 4 input (Công 1, Công 2, Thủ, Rừng)
    // Cho phép nhập 0 để ẩn team
    // Validate: Công >= 0 && <= 20, Thủ/Rừng >= 0 && <= 10
}

async function applyResize(sizes) {
    // Nếu team bị set về 0 → di chuyển người xuống waiting
    // Update Supabase: team_sizes + teams data
    // Re-render panels
}
```

### 6.7. Set Leader

```javascript
async function toggleLeader(userId) {
    // Toggle isTeamLeader/ld cho player
    // Reset tất cả leader trong cùng team trước
    // Update Supabase
    // Re-render (leader có highlight sáng hơn)
}
```

### 6.8. Chốt / Huỷ chốt

```javascript
async function finalizeList() {
    // Cảnh báo
    const msg = 'Sau khi chốt:\n• Bạn không thể chỉnh sửa đội hình\n• Mọi người vẫn đăng ký được nhưng vào hàng chờ\n\nXác nhận chốt?';
    if (!confirm(msg)) return;

    // Đặt locked = true
    await sb.from('bc_sessions').update({ locked: true })
        .eq('guild_id', GUILD_ID).eq('day', currentDay);

    // Gửi embed chốt DS lên Discord qua Webhook
    await sendFinalizeWebhook();

    // Re-render UI: ẩn drag, ẩn kick, ẩn resize
    renderLockedState(true);
}

async function unlockList() {
    if (!confirm('Mở khoá danh sách? Leader sẽ có thể chỉnh sửa lại.')) return;

    await sb.from('bc_sessions').update({ locked: false })
        .eq('guild_id', GUILD_ID).eq('day', currentDay);

    renderLockedState(false);
}

async function sendFinalizeWebhook() {
    // Tạo embed tương tự bcql_finalize_
    // Gửi qua Discord Webhook
    const WEBHOOK_URL = '...'; // Webhook kênh BC
    // ...
}
```

### 6.9. Nút "Luôn tham gia" (chỉ T7/CN)

```javascript
async function toggleRegular() {
    const day = currentDay;
    if (day !== 'sat' && day !== 'sun') return;

    const userId = window.currentDiscordId;

    // Check hiện tại
    const { data } = await sb.from('bc_regulars')
        .select('id')
        .eq('guild_id', GUILD_ID)
        .eq('discord_id', userId)
        .eq('day', day)
        .maybeSingle();

    if (data) {
        // Đang bật → tắt
        await sb.from('bc_regulars').delete()
            .eq('guild_id', GUILD_ID)
            .eq('discord_id', userId)
            .eq('day', day);
    } else {
        // Đang tắt → bật
        await sb.from('bc_regulars').upsert({
            guild_id: GUILD_ID,
            discord_id: userId,
            username: window.currentUserName,
            day: day
        }, { onConflict: 'guild_id,discord_id,day' });
    }

    updateRegularButton();
}
```

### 6.10. Realtime Subscription

```javascript
function setupEditorRealtime() {
    sb.channel('editor-realtime')
      .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'bc_sessions',
          filter: `guild_id=eq.${GUILD_ID}`
      }, (payload) => {
          if (payload.new?.day !== currentDay) return;

          // Cập nhật data local
          currentSessionData = payload.new;

          // Kiểm tra nếu đang drag → không render (tránh giật)
          if (isDragging) return;

          // Re-render
          renderTeamsEditor(payload.new);
          renderLockedState(payload.new.locked);
      })
      .subscribe();
}
```

---

## PHASE 7: Web Team Editor — Design & Styling

### 7.1. Design System

- **Palette:** Kế thừa từ index.html (var(--bg), var(--green-*), var(--gold), var(--dps), etc.)
- **Font:** Inter (Google Fonts)
- **Cards:** Glassmorphism backdrop-filter, border glow
- **Drag visual:** Ghost opacity 0.5, drop zone highlight xanh lá
- **Locked state:** Overlay đỏ nhẹ + icon 🔒, disable tất cả interactive

### 7.2. Responsive

- Desktop: Grid 2 cột (teams | waiting)
- Mobile (< 768px): 1 cột, scroll dọc + touch drag support

### 7.3. Micro-animations

- Card hover: border glow + scale 1.02
- Kick confirm: slide out → slide into waiting
- Drag: smooth translate + shadow elevation
- Leader toggle: gold pulse animation
- Lock/unlock: 🔒 shake animation

---

## PHASE 8: Cập nhật Workflow Realtime.md

### Thêm events mới vào bảng đồng bộ

#### Bot → Web (thêm):
| Event | File Bot | Hàm Sync | Web Handler |
|-------|----------|----------|-------------|
| Kick → Hàng chờ | `bcqlHandlers.js` | `syncSessionToSupabase()` | Realtime UPDATE → `renderTeams()` |
| Chốt DS (locked) | `bcqlHandlers.js` | `setSessionLocked()` | Realtime UPDATE → `renderLockedState()` |
| Toggle Luôn TG | `bcMenuHandlers.js` | `syncBcRegular()` | Poll `bc_regulars` |
| Resize teams | `bcqlHandlers.js` | `syncSessionToSupabase()` | Realtime UPDATE → dynamic render |

#### Web → Bot (thêm):
| Event | File Web | Cách thức | Bot Handler |
|-------|----------|-----------|-------------|
| Kick → Chờ (Team Editor) | `team_editor.html` | Supabase update | Bot polling 8s |
| Drag-drop swap (debounced) | `team_editor.html` | Supabase update (2s debounce) | Bot polling 8s |
| Resize (Team Editor) | `team_editor.html` | Supabase update team_sizes | Bot polling 8s |
| Set Leader (Team Editor) | `team_editor.html` | Supabase update | Bot polling 8s |
| Chốt/Huỷ chốt | `team_editor.html` | Supabase update locked | Bot polling 8s |
| Toggle Luôn TG (web) | `team_editor.html` | Supabase upsert/delete bc_regulars | Bot polling 8s |

---

## Thứ tự thực hiện (theo priority)

### Batch 1 — Foundation (phải làm trước)
1. ✅ Chạy SQL Supabase (Phase 1)
2. ✅ Sửa `supabase_setup.sql`
3. ✅ Thêm sync functions trong `supabaseSync.js` (Phase 3.3, 3.4)

### Batch 2 — Discord Bot Changes
4. Sửa `listbangchien.js` — hiện tất cả ngày (Phase 2)
5. Sửa `bangchien.js` — "Luôn TG" chỉ T7/CN (Phase 3.1)
6. Sửa `bcMenuHandlers.js` — menu chỉ "Luôn TG" primary (Phase 3.2)
7. Sửa `bcqlHandlers.js` — kick→chờ + chốt DS (Phase 4)

### Batch 3 — Web Index
8. Thêm nút "Chỉnh sửa Đội Hình" vào index.html (Phase 5.1, 5.2)
9. Dynamic render ẩn team size=0 (Phase 5.3)
10. Hiển thị trạng thái locked (Phase 5.4)

### Batch 4 — Team Editor (lớn nhất)
11. Tạo `team_editor.html` — layout + auth + fetch data (Phase 6.1-6.3)
12. Kick → chờ + set leader (Phase 6.4, 6.7)
13. Drag-and-drop + debounce (Phase 6.5)
14. Resize modal (Phase 6.6)
15. Chốt / Huỷ chốt (Phase 6.8)
16. Nút "Luôn TG" trên web (Phase 6.9)
17. Realtime subscription (Phase 6.10)
18. Polish & micro-animations (Phase 7)

### Batch 5 — Finalize
19. Cập nhật Realtime.md (Phase 8)
20. Testing toàn bộ luồng

---

## Lưu ý quan trọng

1. **Debounce drag-drop 2s** — Bắt buộc để tránh crash khi leader thao tác nhanh
2. **Locked state** — Khi chốt, joinBC trên index phải tự động vào hàng chờ (không vào team)
3. **Resize về 0** — Phải di chuyển người xuống waiting trước khi set size = 0
4. **bc_regulars chỉ T7/CN** — Day constraint trong SQL: CHECK (day IN ('sat', 'sun'))
5. **Sync thứ tự** — Luôn gọi sync SAU KHI data local đã thay đổi xong
6. **Last Write Wins** — Không cần lock phức tạp, realtime subscribe đủ để 2 leader thấy data mới nhất
