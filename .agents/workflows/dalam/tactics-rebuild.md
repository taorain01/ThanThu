---
description: Workflow đại tu hệ thống Note → Nhiệm Vụ Cascade cho Guild War Tactics
---

# Hệ Thống Nhiệm Vụ (Note → Task Cascade)

## Tổng quan
Chuyển đổi hệ thống ghi chú rời rạc (6 textarea) thành hệ thống Nhiệm Vụ thông minh:
- Leader ghi 1 note với scope (team/role/weapon/cá nhân) → hệ thống cascade xuống từng member
- Mỗi member thấy danh sách nhiệm vụ cá nhân xếp theo timeline
- Có thêm "Lưu ý toàn trận" nằm ngoài timeline
- Tab "Nhiệm vụ" trên index.html (thay nút Thống kê): member thấy của mình, leader thấy tất cả

## Bước 1: Cấu trúc dữ liệu mới (tactics.html)

### Thay thế `notes_team`, `notes_role`, `notes_personal` bằng `mark.tasks[]`

```javascript
mark.tasks = [
    {
        id: "t_abc123",      // crypto.randomUUID() hoặc Date.now()
        time: 1770,          // seconds (29:30)
        scope: "team",       // "all" | "team" | "role" | "weapon" | "personal"
        target: "attack1",   // team ID | "Healer" | "QD" | discord_id
        text: "Tập trung đánh trụ giữa"
    }
];
```

### Thêm `global_notes[]` ở tầng session (ngoài mark)

```javascript
// Lưu trong tacticsData (cùng level với markers)
tacticsData.global_notes = [
    {
        id: "g_abc123",
        scope: "all",        // hoặc team/role/weapon/personal
        target: "all",
        text: "Đừng đánh rừng khi thua trụ"
    }
];
```

### Scope Targets mapping

| Scope | Target | Ai nhận? |
|:--|:--|:--|
| `all` | `"all"` | Toàn bộ 30 người |
| `team` | `"attack1"` | Công 1 |
| `team` | `"attack2"` | Công 2 |
| `team` | `"defense"` | Thủ |
| `team` | `"forest"` | Rừng |
| `role` | `"Healer"` | Tất cả Healer |
| `role` | `"Tanker"` | Tất cả Tanker |
| `role` | `"DPS"` | Tất cả DPS |
| `weapon` | `"QD"` | DPS Quạt Dù |
| `weapon` | `"SD"` | DPS Song Đao |
| `weapon` | `"VD"` | DPS Vô Danh |
| `weapon` | `"9K"` | DPS Cửu Kiếm |
| `weapon` | `"DR"` | DPS Dù Roi |
| `weapon` | `"HD"` | DPS Hoành Đao |
| `personal` | `"discord_id"` | 1 người |

## Bước 2: Normalize + Migrate dữ liệu cũ (tactics.html)

Trong `normalizeMark()`, thêm logic:
1. Nếu mark có `notes_team` / `notes_role` / `notes_personal` nhưng KHÔNG có `tasks` → auto-convert
2. Mỗi `notes_team.noteA1` → task `{ scope: "team", target: "attack1", text: value }`
3. Mỗi `notes_role.noteHealer` → task `{ scope: "role", target: "Healer", text: value }`
4. Mỗi `notes_personal[discordId]` → task `{ scope: "personal", target: discordId, text: value }`
5. `notes_role.dps_checks` → không convert (deprecated)
6. Sau convert xoá fields cũ, chỉ giữ `tasks`

## Bước 3: Redesign Panel Phải (tactics.html)

### Xoá cũ
- Xoá 3 section: Note Team Tổng Quan, Note Vai Trò, Note Cá Nhân
- Xoá 6 textarea + checkbox DPS
- Xoá hàm `saveNotesToMark()`, `loadNotesFromMark()`, `showPersonalNote()`, `loadPersonalNote()`

### Thay bằng UI mới

```html
<!-- Panel Phải mới -->
<div class="panel-right">
  <!-- LƯU Ý TOÀN TRẬN -->
  <div class="note-section">
    <div class="note-section-title">📌 Lưu Ý Toàn Trận</div>
    <div id="globalNotesList"></div>
    <div class="task-input-row" id="globalNoteInput">
      <select id="globalNoteScope"><!-- scopes --></select>
      <input type="text" placeholder="Nhập lưu ý..." id="globalNoteText">
      <button onclick="addGlobalNote()">➕</button>
    </div>
  </div>

  <!-- GHI NHIỆM VỤ (theo timeline) -->
  <div class="note-section" style="flex:1">
    <div class="note-section-title">📝 Nhiệm Vụ (⏰ <span id="taskTimeLabel">30:00</span>)</div>
    <div class="task-input-row" id="taskInput">
      <select id="taskScope"><!-- scopes --></select>
      <input type="text" placeholder="Nhập nhiệm vụ..." id="taskText">
      <button onclick="addTask()">➕</button>
    </div>
    <div id="tasksList"></div>
  </div>
</div>
```

### CSS cho task input

```css
.task-input-row{display:flex;gap:4px;align-items:center;margin-top:6px}
.task-input-row select{flex:0 0 auto;max-width:120px;padding:4px 6px;border-radius:6px;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--text);
  font-size:10px;font-family:inherit}
.task-input-row input{flex:1;padding:5px 8px;border-radius:6px;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--text);
  font-size:11px;font-family:inherit}
.task-input-row button{padding:4px 10px;border-radius:6px;border:1px solid rgba(34,197,94,.3);
  background:rgba(34,197,94,.1);color:var(--green-400);font-size:12px;cursor:pointer;
  font-family:inherit;font-weight:700}
.task-item{display:flex;align-items:flex-start;gap:6px;padding:4px 6px;margin:2px 0;
  border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.04);
  font-size:10px;line-height:1.4}
.task-item .task-scope{color:var(--gold);font-weight:700;white-space:nowrap;min-width:60px}
.task-item .task-text{flex:1;color:var(--text)}
.task-item .task-actions{display:flex;gap:2px;opacity:.5}
.task-item:hover .task-actions{opacity:1}
.task-item .task-del{cursor:pointer;color:var(--red-400);font-size:11px;padding:0 3px}
```

## Bước 4: JavaScript functions (tactics.html)

### Hàm thêm task

```javascript
function addTask() {
    const scope = document.getElementById('taskScope').value;
    const text = document.getElementById('taskText').value.trim();
    if (!text) return;
    const { scopeType, target } = parseScopeValue(scope);
    const mark = getEditableCurrentMark();
    if (!mark) return;
    if (!mark.tasks) mark.tasks = [];
    mark.tasks.push({
        id: 't_' + Date.now(),
        time: viewingTime,
        scope: scopeType,
        target: target,
        text: text
    });
    document.getElementById('taskText').value = '';
    flagMarkDirty();
    renderTasks();
}
```

### Hàm compile nhiệm vụ cho 1 người

```javascript
function matchesScope(task, player, playerId) {
    return task.scope === 'all' ||
        (task.scope === 'team' && player.team === task.target) ||
        (task.scope === 'role' && player.role === task.target) ||
        (task.scope === 'weapon' && player.sub === task.target) ||
        (task.scope === 'personal' && playerId === task.target);
}

function getTasksForPlayer(playerId) {
    const player = findPlayer(playerId);
    const allTasks = [];
    // 1. Global notes
    (tacticsData.global_notes || []).forEach(note => {
        if (matchesScope(note, player, playerId))
            allTasks.push({ ...note, time: null, source: 'global' });
    });
    // 2. Timeline tasks từ tất cả marks
    marks.forEach(mark => {
        (mark.tasks || []).forEach(task => {
            if (matchesScope(task, player, playerId))
                allTasks.push({ ...task, source: 'timeline' });
        });
    });
    return allTasks.sort((a, b) => {
        if (a.source === 'global' && b.source !== 'global') return -1;
        if (a.source !== 'global' && b.source === 'global') return 1;
        return (b.time || 0) - (a.time || 0);
    });
}
```

## Bước 5: Đổi nút Thống kê → Nhiệm vụ (index.html)

1. Tìm nút/tab "Thống kê" (`pane-stats`) → đổi label và icon
2. Nội dung tab fetch `bc_tactics` LIVE → compile tasks per member
3. Phân quyền:
   - `isLeader = true` → hiện accordion 30 người, expand xem tasks từng người
   - `isLeader = false` → chỉ hiện tasks của `currentDiscordId`

### UI Tab Nhiệm vụ — Member View:
```
📋 NHIỆM VỤ CỦA BẠN — Thứ 7
─────────────────────
📌 LƯU Ý CHUNG
• Đừng đánh rừng khi thua trụ
⏰ THEO TIMELINE
30:00  [Toàn đội] Tập hợp vị trí
29:30  [Công 1] Đánh trụ giữa
27:00  [Cá nhân] Rush boss
```

### UI Tab Nhiệm vụ — Leader View:
```
📋 NHIỆM VỤ TOÀN ĐỘI — Thứ 7
🔍 Tìm kiếm...
▼ TaoRain — Công 1 • DPS [QD]
  📌 Đừng đánh rừng khi thua trụ
  30:00  [Toàn đội] Tập hợp
  29:30  [Công 1] Đánh trụ giữa
▶ BaoPhong — Công 1 • DPS [VD]
▶ KiemThan — Công 1 • Healer
```

## Bước 6: Render + Sync

1. `renderTasks()` — render danh sách task đã ghi trên panel phải tactics, nhóm theo time
2. `renderGlobalNotes()` — render lưu ý toàn trận
3. Khi chuyển mark trên timeline → gọi `renderTasks()` để hiện tasks của mark đó
4. `formatTime(seconds)` hiển thị MM:SS cho cột time
5. Khi bấm 💾 Lưu → `mark.tasks[]` + `global_notes[]` đều đi theo data lên Supabase

## Lưu ý quan trọng
- Tất cả `notes_team`, `notes_role`, `notes_personal` sẽ bị deprecated → auto-migrate sang `tasks[]`
- `global_notes` lưu ở tầng `tacticsData` (cùng level với `markers`), KHÔNG nằm trong mark
- Tab Nhiệm vụ trên index cần fetch `bc_tactics` → nếu chưa có data thì hiện "Chưa có chiến thuật"
- Scope dropdown populate từ danh sách cố định + danh sách member hiện tại (cho personal scope)
