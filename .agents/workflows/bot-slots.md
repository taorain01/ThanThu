---
description: Thêm Bot Slots vào sa bàn chiến thuật (tactics.html) — Cho phép leader tạo quân giả để setup chiến thuật trước khi đủ 30 người thật
---

# Workflow: Bot Slots cho Sa Bàn Chiến Thuật

## Tổng quan
- **File duy nhất cần sửa**: `web/tactics.html`
- **3 phần cần thêm**: CSS → HTML → JavaScript
- **Thứ tự thực hiện**: 7 bước tuần tự

---

## BƯỚC 1: Thêm CSS (trong block `<style>`)

**Vị trí**: Tìm cuối block `<style>` (trước `</style>` — khoảng dòng 910).
Thêm ngay trước `</style>`:

```css
/* ═══ BOT SLOTS ═══ */
--bot: #a78bfa;

/* Bot trong panel trái */
.player-item.is-bot { border-left: 2px dashed var(--bot); }
.player-item.is-bot .p-name { color: var(--bot); }
.player-item.is-bot .p-name::before { content: '🤖 '; }
.player-item.is-bot .p-role { background: rgba(167,139,250,.15); color: var(--bot); }

/* Bot trên map — chấm tím nhấp nháy */
.map-player.is-bot .mp-dot {
  background: radial-gradient(circle at 35% 35%, #c4b5fd, #7c3aed 60%, #5b21b6) !important;
  border: 2px dashed rgba(255,255,255,.6) !important;
  animation: botPulse 2s ease-in-out infinite;
}
@keyframes botPulse {
  0%, 100% { opacity: .7; box-shadow: 0 0 6px rgba(167,139,250,.5), 0 2px 4px rgba(0,0,0,.6); }
  50% { opacity: 1; box-shadow: 0 0 16px rgba(167,139,250,.9), 0 2px 4px rgba(0,0,0,.6); }
}

/* Label bot trên map */
.map-player.is-bot .mp-label { color: var(--bot) !important; }
.map-player.is-bot .mp-label::after {
  content: '⚠ Bot'; display: block;
  font-size: calc(8px * var(--map-scale,1));
  color: #fbbf24; font-weight: 800;
}

/* Bot quick bar (giống enemy-quick-bar) */
.bot-quick-bar { display:flex; gap:4px; padding:4px 6px; flex-wrap:wrap; }
```

**Lưu ý**: `--bot` phải đặt trong `:root` hoặc `.panel-left` nếu muốn dùng CSS variable. Nếu không, dùng trực tiếp `#a78bfa`.

---

## BƯỚC 2: Thêm HTML Section Bot (trong panel trái)

**Vị trí chính xác**: Sau section `secFR` (Rừng, dòng ~952), **TRƯỚC** section `secEnemy` (Kẻ Địch, dòng ~954).

Tìm đoạn:
```html
    </div>
    <!-- Enemy -->
    <div class="panel-section" id="secEnemy">
```

Thêm **TRƯỚC** `<!-- Enemy -->`:
```html
    <!-- Bot Slots -->
    <div class="panel-section collapsed" id="secBot">
      <div class="panel-section-header" onclick="toggleSection('secBot')"><span class="ps-chevron">▼</span><span class="ps-title">🤖 Bot</span><span class="ps-count" id="botCount">0</span></div>
      <div class="panel-section-body">
        <div class="bot-quick-bar" id="botQuickBar" style="display:none">
          <button class="eq-btn" onclick="addBotSlots(1)">+1</button>
          <button class="eq-btn" onclick="addBotSlots(3)">+3</button>
          <button class="eq-btn" onclick="addBotSlots(5)">+5</button>
          <button class="eq-btn" onclick="fillBotsToMax()">Lấp đầy</button>
          <button class="eq-btn eq-clear" onclick="clearAllBots()">🗑</button>
        </div>
        <div id="botList"></div>
      </div>
    </div>
```

---

## BƯỚC 3: Thêm biến global + hàm bot mới (JavaScript)

**Vị trí**: Thêm block mới sau `function getAllPlayers()` (dòng ~6607), trước `// ═══ CONTEXT MENU ═══` (dòng ~6609).

### 3A. Biến global
```js
// ═══ BOT SLOTS ═══
let botSlots = [];     // Mảng bot slots: [{id, name, role, sub, team, isBot}]
let botIdCounter = 0;  // Counter để tạo ID duy nhất
```

### 3B. Hàm thêm bot
```js
function addBotSlots(count) {
    if (!isLeader) return;
    const realCount = getAllPlayers().length;
    const maxAdd = Math.max(0, 30 - realCount - botSlots.length);
    const toAdd = Math.min(count, maxAdd);
    if (toAdd <= 0) { toast('⚠️ Đã đủ 30 người (thật + bot)'); return; }

    const roles = distributeRoles(toAdd);
    const teamSlots = getTeamSlotAvailability();

    for (let i = 0; i < toAdd; i++) {
        const seq = ++botIdCounter;
        const team = pickTeamWithSlot(teamSlots);
        botSlots.push({
            id: `bot_${seq}`,
            name: `Bot ${String(seq).padStart(2, '0')}`,
            role: roles[i] || 'DPS',
            sub: '',
            team: team,
            isBot: true
        });
    }
    renderBotPanel();
    renderTeamList();
    syncPanelOnMap();
    toast(`🤖 Đã thêm ${toAdd} bot (${botSlots.length} bot tổng)`);
}
```

### 3C. Hàm lấp đầy
```js
function fillBotsToMax() {
    if (!isLeader) return;
    const realCount = getAllPlayers().length;
    const need = 30 - realCount - botSlots.length;
    if (need <= 0) { toast('⚠️ Đã đủ 30 người'); return; }
    addBotSlots(need);
}
```

### 3D. Hàm phân role theo tỉ lệ
```js
function distributeRoles(count) {
    // Đếm role hiện tại (thật + bot)
    const all = [...getAllPlayers(), ...botSlots];
    let dps = 0, heal = 0, tank = 0;
    all.forEach(p => {
        if (p.role === 'Healer') heal++;
        else if (p.role === 'Tanker') tank++;
        else dps++;
    });
    const total = all.length + count;
    // Tỉ lệ mục tiêu: 60% DPS, 20% Heal, 20% Tank
    const targetDps = Math.round(total * 0.6);
    const targetHeal = Math.round(total * 0.2);
    const targetTank = total - targetDps - targetHeal;

    const roles = [];
    for (let i = 0; i < count; i++) {
        const needDps = targetDps - dps;
        const needHeal = targetHeal - heal;
        const needTank = targetTank - tank;
        if (needHeal >= needTank && needHeal >= needDps && needHeal > 0) { roles.push('Healer'); heal++; }
        else if (needTank >= needDps && needTank > 0) { roles.push('Tanker'); tank++; }
        else { roles.push('DPS'); dps++; }
    }
    return roles;
}
```

### 3E. Hàm tính slot trống theo team
```js
function getTeamSlotAvailability() {
    const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
    const sizes = typeof sessionData?.team_sizes === 'string'
        ? JSON.parse(sessionData.team_sizes || '{}')
        : (sessionData?.team_sizes || {});
    const teams = [
        { key: 'team_attack1', max: sizes.attack1 || 10 },
        { key: 'team_attack2', max: sizes.attack2 || 10 },
        { key: 'team_defense', max: sizes.defense ?? 5 },
        { key: 'team_forest',  max: sizes.forest ?? 5 }
    ];
    return teams.map(t => {
        const real = parse(sessionData?.[t.key]).length;
        const bots = botSlots.filter(b => b.team === t.key).length;
        return { key: t.key, max: t.max, used: real + bots, free: Math.max(0, t.max - real - bots) };
    });
}

function pickTeamWithSlot(teamSlots) {
    const available = teamSlots.filter(t => t.free > 0);
    if (available.length === 0) return 'team_attack1';
    const pick = available[0];
    pick.used++; pick.free--;
    return pick.key;
}
```

### 3F. Hàm xóa bot
```js
function removeBotSlot(id) {
    botSlots = botSlots.filter(b => b.id !== id);
    // Xóa bot khỏi tất cả marks (nếu đang trên map)
    marks.forEach(mark => {
        if (mark.players) mark.players = mark.players.filter(p => p.id !== id);
        // Xóa khỏi tower_guards
        Object.keys(mark.tower_guards || {}).forEach(tid => {
            mark.tower_guards[tid] = (mark.tower_guards[tid] || []).filter(gid => gid !== id);
        });
    });
    renderBotPanel(); renderTeamList(); renderPlayersOnMap(); syncPanelOnMap();
}

function clearAllBots() {
    if (!botSlots.length) return;
    if (!confirm(`Xóa tất cả ${botSlots.length} bot?`)) return;
    const botIds = new Set(botSlots.map(b => b.id));
    marks.forEach(mark => {
        if (mark.players) mark.players = mark.players.filter(p => !botIds.has(p.id));
        Object.keys(mark.tower_guards || {}).forEach(tid => {
            mark.tower_guards[tid] = (mark.tower_guards[tid] || []).filter(gid => !botIds.has(gid));
        });
    });
    botSlots = [];
    botIdCounter = 0;
    renderBotPanel(); renderTeamList(); renderPlayersOnMap(); syncPanelOnMap(); renderTargeting();
    toast('🗑️ Đã xóa tất cả bot');
}
```

### 3G. Hàm render panel bot
```js
function renderBotPanel() {
    const container = document.getElementById('botList');
    const countEl = document.getElementById('botCount');
    const quickBar = document.getElementById('botQuickBar');
    if (!container) return;

    countEl.textContent = botSlots.length;
    quickBar.style.display = isLeader && gamePhase !== 'setup' ? 'flex' : 'none';
    container.innerHTML = '';

    botSlots.forEach(bot => {
        const roleCls = bot.role === 'Healer' ? 'healer' : bot.role === 'Tanker' ? 'tanker' : '';
        const teamLabels = { team_attack1: 'Công 1', team_attack2: 'Công 2', team_defense: 'Thủ', team_forest: 'Rừng' };
        const div = document.createElement('div');
        div.className = 'player-item is-bot' + (gamePhase === 'setup' ? ' setup-locked' : '');
        div.dataset.playerId = bot.id;
        div.dataset.team = bot.team;
        div.innerHTML = `
            <div class="p-avatar ${roleCls}"><img src="./anh/icons/${bot.role.toLowerCase()}.png" style="width:100%;height:100%;border-radius:50%;object-fit:cover"></div>
            <span class="p-name">${bot.name}</span>
            <span class="p-role ${roleCls}">${bot.role} · ${teamLabels[bot.team] || bot.team}</span>`;
        // Cho phép kéo thả giống player thật (mousedown listener giống renderTeamList)
        container.appendChild(div);
    });
}
```

### 3H. Hàm auto-replace (LÕI QUAN TRỌNG NHẤT)
```js
function autoReplaceBots(oldRoster, newRoster) {
    if (!botSlots.length) return;
    const oldIds = new Set(oldRoster.map(p => p.id));
    const newPlayers = newRoster.filter(p => !oldIds.has(p.id));
    if (!newPlayers.length) return;

    newPlayers.forEach(newPlayer => {
        if (!botSlots.length) return;
        const bot = findBestBotMatch(newPlayer);
        if (!bot) return;

        // Thay bot bằng player thật trong tất cả marks
        const crossTeam = bot.team !== (newPlayer.team || 'team_attack1');
        marks.forEach(mark => {
            // Thay trong players array
            (mark.players || []).forEach(p => {
                if (p.id === bot.id) {
                    p.id = newPlayer.id;
                    p.name = newPlayer.gn || newPlayer.name || newPlayer.username || 'Unknown';
                    p.role = newPlayer.role || 'DPS';
                    p.sub = newPlayer.sub || '';
                    p.team = newPlayer.team || 'team_attack1';
                    delete p.isBot;
                    // Giữ nguyên p.x, p.y → kế thừa vị trí
                }
            });
            // Thay trong tower_guards
            Object.keys(mark.tower_guards || {}).forEach(tid => {
                mark.tower_guards[tid] = (mark.tower_guards[tid] || []).map(
                    gid => gid === bot.id ? newPlayer.id : gid
                );
            });
            // Thay trong targeting
            (mark.targeting || []).forEach(t => {
                if (t.from === bot.id) t.from = newPlayer.id;
            });
        });

        // Xóa bot khỏi botSlots
        botSlots = botSlots.filter(b => b.id !== bot.id);

        const displayName = newPlayer.gn || newPlayer.name || 'Unknown';
        if (crossTeam) {
            toast(`🔄 ${bot.name} → ${displayName} ⚠ Kiểm tra vị trí!`);
        } else {
            toast(`🔄 ${bot.name} → ${displayName}`);
        }
    });

    if (newPlayers.length > 0) {
        renderBotPanel();
    }
}

function findBestBotMatch(player) {
    const team = player.team || 'team_attack1';
    const role = player.role || 'DPS';
    // Ưu tiên 1: cùng team + cùng role
    let match = botSlots.find(b => b.team === team && b.role === role);
    if (match) return match;
    // Ưu tiên 2: cùng team + khác role
    match = botSlots.find(b => b.team === team);
    if (match) return match;
    // Ưu tiên 3: khác team + cùng role
    match = botSlots.find(b => b.role === role);
    if (match) return match;
    // Ưu tiên 4: bất kỳ
    return botSlots[0] || null;
}
```

### 3I. Hàm manual replace (context menu)
```js
function replaceBotManual(botId, realPlayerId) {
    const bot = botSlots.find(b => b.id === botId);
    const realPlayer = getAllPlayers().find(p => p.id === realPlayerId);
    if (!bot || !realPlayer) return;

    marks.forEach(mark => {
        (mark.players || []).forEach(p => {
            if (p.id === botId) {
                p.id = realPlayer.id;
                p.name = realPlayer.gn || realPlayer.name || 'Unknown';
                p.role = realPlayer.role || 'DPS';
                p.sub = realPlayer.sub || '';
                p.team = realPlayer.team || 'team_attack1';
                delete p.isBot;
            }
        });
        Object.keys(mark.tower_guards || {}).forEach(tid => {
            mark.tower_guards[tid] = (mark.tower_guards[tid] || []).map(
                gid => gid === botId ? realPlayer.id : gid
            );
        });
        (mark.targeting || []).forEach(t => {
            if (t.from === botId) t.from = realPlayer.id;
        });
    });

    botSlots = botSlots.filter(b => b.id !== botId);
    renderBotPanel(); renderPlayersOnMap(); syncPanelOnMap(); renderTargeting();
    closeCtx();
    toast(`🔄 ${bot.name} → ${realPlayer.gn || realPlayer.name}`);
}
```

---

## BƯỚC 4: Sửa hàm `getAllPlayers()` (dòng ~6593)

**Hiện tại:**
```js
function getAllPlayers() {
    if (!sessionData) return [];
    const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
    const teams = [
        { key: 'team_attack1', label: 'Công 1' },
        { key: 'team_attack2', label: 'Công 2' },
        { key: 'team_defense', label: 'Thủ' },
        { key: 'team_forest', label: 'Rừng' }
    ];
    const all = [];
    teams.forEach(t => {
        parse(sessionData[t.key]).forEach(p => all.push({...p, team: t.key, teamLabel: t.label}));
    });
    return all;
}
```

**SỬA THÀNH:**
```js
function getAllPlayers() {
    if (!sessionData) return [];
    const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
    const teams = [
        { key: 'team_attack1', label: 'Công 1' },
        { key: 'team_attack2', label: 'Công 2' },
        { key: 'team_defense', label: 'Thủ' },
        { key: 'team_forest', label: 'Rừng' }
    ];
    const all = [];
    teams.forEach(t => {
        parse(sessionData[t.key]).forEach(p => all.push({...p, team: t.key, teamLabel: t.label}));
    });
    // Thêm bot slots vào danh sách
    const teamLabels = { team_attack1: 'Công 1', team_attack2: 'Công 2', team_defense: 'Thủ', team_forest: 'Rừng' };
    botSlots.forEach(b => all.push({...b, teamLabel: teamLabels[b.team] || b.team}));
    return all;
}
```

---

## BƯỚC 5: Sửa hàm `renderTeamList()` (dòng ~2975)

**Tìm đoạn trong hàm, sau `players.forEach(p => {...})` (dòng ~3004), trước `});` đóng `teams.forEach`:**

Thêm sau dòng render player thật nhưng TRƯỚC `});` của `teams.forEach`:
```js
        // Thêm bot slots thuộc team này
        botSlots.filter(b => b.team === t.key).forEach(bot => {
            const role = bot.role || 'DPS';
            const roleCls = role === 'Healer' ? 'healer' : role === 'Tanker' ? 'tanker' : '';
            const div = document.createElement('div');
            div.className = 'player-item is-bot' + (gamePhase === 'setup' ? ' setup-locked' : '');
            div.dataset.playerId = bot.id;
            div.dataset.team = t.key;
            div.dataset.sub = '';
            div.innerHTML = `
                <div class="p-avatar ${roleCls}"><img src="./anh/icons/${role.toLowerCase()}.png" style="width:100%;height:100%;border-radius:50%;object-fit:cover"></div>
                <span class="p-name">${bot.name}</span>
                <span class="p-role ${roleCls}">${role}</span>`;
            container.appendChild(div);
        });
```

Đồng thời cập nhật count hiển thị: thay dòng:
```js
document.getElementById(t.countEl).textContent = players.length;
```
thành:
```js
document.getElementById(t.countEl).textContent = players.length + botSlots.filter(b => b.team === t.key).length;
```

---

## BƯỚC 6: Sửa hàm `renderSinglePlayer()` (dòng ~7358)

**Tìm dòng:**
```js
el.className = 'map-player';
```

**Sửa thành:**
```js
el.className = 'map-player' + (p.isBot ? ' is-bot' : '');
```

---

## BƯỚC 7: Sửa các hàm tích hợp còn lại

### 7A. `applyRealtimeSessionData()` (dòng ~2307)

Thêm auto-replace logic. Tìm hàm `applyRealtimeSessionData`:
```js
function applyRealtimeSessionData(data, options = {}) {
    if (!data) return;
```

**Sửa thành:**
```js
function applyRealtimeSessionData(data, options = {}) {
    if (!data) return;
    // Auto-replace bots khi có player mới đăng ký
    if (botSlots.length > 0 && sessionData) {
        const oldRoster = getAllPlayers().filter(p => !p.isBot);
        const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch(e) { return []; } };
        const newRoster = [
            ...parse(data.team_attack1).map(p => ({...p, team: 'team_attack1'})),
            ...parse(data.team_attack2).map(p => ({...p, team: 'team_attack2'})),
            ...parse(data.team_defense).map(p => ({...p, team: 'team_defense'})),
            ...parse(data.team_forest).map(p => ({...p, team: 'team_forest'}))
        ];
        autoReplaceBots(oldRoster, newRoster);
    }
```

### 7B. `showPlayerCtx()` (dòng ~7403)

Tìm cuối hàm, trước `openContextMenuHtml(...)`:
```js
    // Note cá nhân
    html += `<div class="ctx-sep"></div>
    <div class="ctx-item" onclick="selectPersonalScope('${player.id}');closeCtx()">...Ghi nhiệm vụ</div>`;
```

**Thêm SAU đoạn trên, TRƯỚC `openContextMenuHtml`:**
```js
    // Bot: thêm menu thay thế + xóa
    if (player.isBot) {
        const unassigned = getAllPlayers().filter(p => !p.isBot && !isPlayerAssigned(p.id));
        if (unassigned.length > 0) {
            html += `<div class="ctx-sep"></div>
            <div class="ctx-sub-title">🔄 Thay bằng người thật</div>`;
            unassigned.slice(0, 10).forEach(rp => {
                const rName = rp.gn || rp.name || 'Unknown';
                html += `<div class="ctx-item" onclick="replaceBotManual('${player.id}','${rp.id}')"><span class="ci-icon">👤</span>${rName} (${rp.role})</div>`;
            });
        }
        html += `<div class="ctx-sep"></div>
        <div class="ctx-item" onclick="removeBotSlot('${player.id}');closeCtx()"><span class="ci-icon">🗑</span>Xóa bot</div>`;
    }
```

### 7C. `buildPersistedTacticsPayload()` (dòng ~4695)

Thêm `botSlots` vào payload. Tìm `return {`:
```js
function buildPersistedTacticsPayload() {
    return {
        marks: normalizeMarks(marks),
        enemyList: enemyList.map(normalizeEnemyEntry),
```

**Thêm field:**
```js
        botSlots: botSlots,
        botIdCounter: botIdCounter,
```

### 7D. `applySavedTacticsPayload()` (dòng ~2238)

Thêm deserialize botSlots. Tìm đoạn cuối hàm, trước `return true;`:
```js
    marks = normalizeMarks(saved.marks);
    tacticsGlobalNotes = normalizeGlobalNotes(saved.global_notes);
```

**Thêm SAU:**
```js
    // Khôi phục bot slots
    if (Array.isArray(saved.botSlots)) {
        botSlots = saved.botSlots;
        botIdCounter = saved.botIdCounter || botSlots.length;
    }
```

### 7E. `isPlayerAssigned()` (dòng ~1348)

Hàm hiện tại đã hoạt động đúng vì nó check `getMarkPlayers().some(p => p.id === pid)` — bot khi đã trên map sẽ nằm trong mark.players nên tự động recognized. **KHÔNG CẦN SỬA**.

### 7F. `buildSetupUnits()` (dòng ~2687)

Hàm này nhận `roster` từ `getAllPlayers()` → vì bước 4 đã include bot vào `getAllPlayers()`, **roster tự động có bot**. **KHÔNG CẦN SỬA** hàm này.

### 7G. `renderBotPanel()` cần gọi khi phase thay đổi

Tìm mọi nơi gọi `renderTeamList()` và thêm `renderBotPanel()` ngay sau. Các vị trí chính:
- `applyRealtimeSessionData()` (dòng ~2316) — đã có `renderTeamList()`, thêm `renderBotPanel()` ngay sau
- `loadSessionData()` cuối hàm (dòng ~2367) — tương tự
- `resetTacticsFromScratch()` (dòng ~2213) — thêm `renderBotPanel();` và reset botSlots

---

## Kiểm tra sau khi code xong

1. Mở `http://127.0.0.1:8889/tactics.html?day=sat&admin=1`
2. Mở devtools console, kiểm tra không có lỗi
3. Mở panel Bot (click vào 🤖 Bot), nhấn `+5` → 5 bot xuất hiện
4. Nhấn `Lấp đầy` → số bot + thật = 30
5. Kéo 1 bot từ panel ra map → chấm tím nhấp nháy, label "⚠ Bot"
6. Chuột phải bot trên map → thấy menu "Thay bằng người thật"
7. Lưu chiến thuật (💾) → reload trang → bot vẫn còn
8. Xóa bớt bot → verify map + panel cập nhật đúng

---

## Ghi chú quan trọng

- **KHÔNG sửa `index.html`** — Bot chỉ tồn tại trong tactics
- **KHÔNG sửa Discord bot** — Bot slots là local data
- **Bot slots lưu trong `tactics_data`** (bảng `bc_tactics` trên Supabase), cùng marks
- **Khi người thật đăng ký**: Realtime update → `applyRealtimeSessionData()` → `autoReplaceBots()` — tự động thay thế
- **Drag-drop bot từ panel ra map**: Dùng cùng hệ thống drag-drop player thật (mousedown listener trên `.player-item`) — item có class `.is-bot` vẫn hoạt động vì logic check `dataset.playerId`
