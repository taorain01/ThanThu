---
description: Nâng cấp Map Review Chiến Thuật trên index.html — Zoom/Pan, Timeline tương tác, Fullscreen, Redesign UI, Mobile Landscape
---

# Workflow: Nâng Cấp Map Review Chiến Thuật

## Tổng quan yêu cầu

```
Trang index.html (Web Bang Chiến):
├── Xoá thanh cuộn ngang
├── Auto-show map review khi vào session có chiến thuật
├── Double-click zoom 2x + giữ chuột kéo pan bản đồ
├── Timeline tương tác: click vào mốc như khi edit chiến thuật
├── Đồng bộ hiển thị boss vàng, PVP 20:00, bãi quái rừng
├── Nút Toàn màn hình (map + timeline + tab nhiệm vụ)
├── Redesign UI premium (glow, glassmorphism, animation)
└── Mobile responsive + landscape fullscreen

Trang team_editor.html:
├── Hiển thị vũ khí kèm role DPS (VD, QD, SD...)
└── Fix nút "Đang đồng bộ" ở hàng chờ
```

**File chính:** `c:\ALABASTA\ThanThu\WebBangChien\index.html` (~3210 dòng)
**File phụ:** `c:\ALABASTA\ThanThu\WebBangChien\team_editor.html` (~1220 dòng)

**Nguyên tắc:**
- Thêm code mới vào **cuối CSS** và **cuối JS** để giảm rủi ro xung đột
- Không xoá hàm cũ, chỉ wrap/extend
- Test từng bước trước khi sang bước tiếp

---

## Giai đoạn 0: Fix Team Editor (Hoàn thành)

### [x] Bước 0.1: Hiển thị vũ khí cho role DPS ở team_editor.html

**File:** `team_editor.html` — hàm `renderMemberRow()` (dòng ~646)

**Thay đổi:** Thêm `member.sub` vào role-tag:
```javascript
// Trước:
<div class="role-tag ${cls}">${member.role || 'DPS'}</div>

// Sau:
<div class="role-tag ${cls}">${member.role || 'DPS'}${member.sub ? ' [' + member.sub + ']' : ''}</div>
```

**Kết quả:** DPS sẽ hiện `DPS [VD]`, `DPS [QD]`... giống index.html

### [x] Bước 0.2: Fix nút "Đang đồng bộ" ở hàng chờ

**File:** `team_editor.html`

**Kết quả:** Hiện "Sẵn sàng" mặc định, "Đã cập nhật" sau khi load xong.

### [x] Bước 0.3: Thêm nút Đội Hình / Chiến Thuật vào mobile bottom nav

**File:** `index.html` — HTML mobile nav (dòng ~913)

**Thay đổi:** Thêm 2 tab mới vào `.mobile-nav`:
```html
<div class="mob-tab" data-target="mob-editor" onclick="switchMobileTab(this)">✏️<span>Đội Hình</span></div>
<div class="mob-tab" data-target="mob-tactics" onclick="switchMobileTab(this)">⚔️<span>Chiến Thuật</span></div>
```

**JS:** Cập nhật hàm `switchMobileTab()` — khi bấm `mob-editor` → gọi `openTeamEditor()`, `mob-tactics` → gọi `openTactics()` (có animation chuyển trang).

### [x] Bước 0.4: Redesign nút Discord + Modal thông tin user

**File:** `index.html`

**Thay đổi 1 — User Badge:**
- Đưa hẳng về bên phải đối xứng với logo LANG GIA.
- Redesign style Golden (vàng kim), font Playfair Display, kèm hiệu ứng ánh sáng quét (shineSweep) giống hệt logo chính.

**Thay đổi 2 — Profile Modal 2 tab:**
- **Tab Thông tin:** Fetch từ `bc_users` Supabase → hiển thị: Tên game, UID, Chức vụ, Vũ khí/Sub role, BC đang đăng ký

### [x] Bước 0.5: Đồng bộ & hiển thị hệ thống EXP + Level

**Nguồn thay đổi:** `economy.js`, `ready.js`, `supabaseSync.js` (Bot) & `index.html` (Web)
- **Bot:** Bắt sự kiện mỗi khi người dùng có EXP (Chat/Voice) để push data `total_exp`, `level`, `messages`, `voice` lên bảng `bc_exp_levels` trên Supabase (Real-time). Sync toàn bộ khi bot start.
- **Web:** Fetch thẳng từ bảng `bc_exp_levels`.
- **UI:** Redesign lại toàn bộ tab Level với Rank Card tuyệt đẹp: Hiển thị thanh Progress bar mượt mà, phân loại rõ Text vs Voice, hiển thị `#Rank` server, và làm nổi bật Tier (ví dụ: *~ Lữ Khách* in đậm, màu vàng kim). Cập nhật realtime.

---

## Giai đoạn 1: Xoá Thanh Cuộn Ngang

### [ ] Bước 1.1: Thêm overflow-x: hidden vào CSS

**File:** `index.html` — phần `<style>`, thêm vào cuối CSS (trước `</style>`)

```css
/* ═══ FIX: Xoá thanh cuộn ngang ═══ */
html, body { overflow-x: hidden; }
.app { overflow-x: hidden; max-width: 100vw; }
```

### [ ] Bước 1.2: Kiểm tra

- Mở index.html trên Chrome, resize cửa sổ nhỏ lại
- Không còn thanh cuộn ngang ở bất kỳ kích thước nào
- Nội dung không bị cắt, vẫn cuộn dọc bình thường

---

## Giai đoạn 2: Auto-show Map Review Khi Có Chiến Thuật

### [ ] Bước 2.1: Sửa hàm loadBCData() để auto-load tactics

**File:** `index.html` — hàm `loadBCData()` (dòng ~1448)

Sau khi gọi `renderTeams(data)`, thêm:

```javascript
// Auto-show map review nếu đã có chiến thuật
loadTacticsForViewer();
```

**Lưu ý:** Hàm `loadTacticsForViewer()` đã tồn tại (dòng ~2774). Nó sẽ tự kiểm tra có data chiến thuật hay không và hiện/ẩn tương ứng.

### [ ] Bước 2.2: Auto chuyển sang tab Bản đồ khi có chiến thuật

Trong hàm `loadTacticsForViewer()`, sau dòng `tvShowAll()` (dòng ~2812), thêm:

```javascript
// Auto chuyển sang tab Bản đồ khi load lần đầu
const mapTab = document.querySelector('.r-tab');
if (mapTab && !mapTab.classList.contains('active')) {
    switchRTab(mapTab, 'pane-map');
}
```

### [ ] Bước 2.3: Kiểm tra

- Vào session có chiến thuật → map review hiện ngay, không cần bấm tab
- Vào session chưa có chiến thuật → hiện bình thường (tab đội hình)

---

## Giai đoạn 3: Double-click Zoom + Drag Pan Bản Đồ

### [ ] Bước 3.1: Thêm CSS cho zoom/pan

**File:** `index.html` — cuối `<style>`

```css
/* ═══ MAP ZOOM & PAN ═══ */
.map-box { position: relative; overflow: hidden; }
.map-box .map-zoom-wrapper {
    width: 100%; height: 100%;
    transform-origin: var(--zoom-ox, 50%) var(--zoom-oy, 50%);
    transform: scale(var(--zoom-level, 1)) translate(var(--pan-x, 0px), var(--pan-y, 0px));
    transition: transform 0.35s cubic-bezier(.25,.46,.45,.94);
    will-change: transform;
}
.map-box.zoomed { cursor: grab; }
.map-box.zoomed.grabbing { cursor: grabbing; }
.map-box.zoomed .map-zoom-wrapper { transition: none; }
/* Indicator nhỏ góc phải: "Nhấp đúp để phóng to" */
.map-zoom-hint {
    position: absolute; bottom: 8px; right: 8px; z-index: 10;
    padding: 4px 10px; border-radius: 8px;
    background: rgba(0,0,0,.55); backdrop-filter: blur(6px);
    color: rgba(255,255,255,.6); font-size: 11px; font-weight: 600;
    pointer-events: none; opacity: 1;
    transition: opacity 0.3s;
}
.map-box.zoomed .map-zoom-hint { opacity: 0; }
```

### [ ] Bước 3.2: Wrap nội dung map-box trong zoom wrapper

**File:** `index.html` — JS, thêm vào cuối `<script>` (trước `</script>`)

```javascript
// ═══ MAP ZOOM & PAN — Double-click zoom 2x, drag pan ═══
(function initMapZoomPan() {
    const mapBox = document.getElementById('mapBox');
    if (!mapBox) return;

    // Wrap tất cả children vào .map-zoom-wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'map-zoom-wrapper';
    while (mapBox.firstChild) wrapper.appendChild(mapBox.firstChild);
    mapBox.appendChild(wrapper);

    // Thêm hint
    const hint = document.createElement('div');
    hint.className = 'map-zoom-hint';
    hint.textContent = '🔍 Nhấp đúp để phóng to';
    mapBox.appendChild(hint);

    let isZoomed = false;
    let panX = 0, panY = 0;
    let startX, startY, startPanX, startPanY;
    let isPanning = false;
    const ZOOM_LEVEL = 2;

    function applyTransform(animate = false) {
        if (animate) wrapper.style.transition = 'transform 0.35s cubic-bezier(.25,.46,.45,.94)';
        else wrapper.style.transition = 'none';
        wrapper.style.setProperty('--zoom-level', isZoomed ? ZOOM_LEVEL : 1);
        wrapper.style.setProperty('--pan-x', panX + 'px');
        wrapper.style.setProperty('--pan-y', panY + 'px');
        mapBox.classList.toggle('zoomed', isZoomed);
    }

    function clampPan() {
        if (!isZoomed) { panX = 0; panY = 0; return; }
        const rect = mapBox.getBoundingClientRect();
        const maxX = (rect.width * (ZOOM_LEVEL - 1)) / (2 * ZOOM_LEVEL);
        const maxY = (rect.height * (ZOOM_LEVEL - 1)) / (2 * ZOOM_LEVEL);
        panX = Math.max(-maxX, Math.min(maxX, panX));
        panY = Math.max(-maxY, Math.min(maxY, panY));
    }

    // Double-click: toggle zoom
    mapBox.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (isZoomed) {
            isZoomed = false; panX = 0; panY = 0;
        } else {
            isZoomed = true;
            // Zoom vào vị trí click
            const rect = mapBox.getBoundingClientRect();
            const ox = ((e.clientX - rect.left) / rect.width) * 100;
            const oy = ((e.clientY - rect.top) / rect.height) * 100;
            wrapper.style.setProperty('--zoom-ox', ox + '%');
            wrapper.style.setProperty('--zoom-oy', oy + '%');
            panX = 0; panY = 0;
        }
        applyTransform(true);
    });

    // Mouse drag pan khi zoomed
    mapBox.addEventListener('mousedown', (e) => {
        if (!isZoomed || e.button !== 0) return;
        // Không pan nếu click vào interactive element
        if (e.target.closest('.map-icon, .tv-player, .tv-enemy, .ttm-mark, button')) return;
        isPanning = true;
        startX = e.clientX; startY = e.clientY;
        startPanX = panX; startPanY = panY;
        mapBox.classList.add('grabbing');
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        const dx = (e.clientX - startX) / ZOOM_LEVEL;
        const dy = (e.clientY - startY) / ZOOM_LEVEL;
        panX = startPanX + dx;
        panY = startPanY + dy;
        clampPan();
        applyTransform(false);
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            mapBox.classList.remove('grabbing');
        }
    });

    // ESC: reset zoom
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isZoomed) {
            isZoomed = false; panX = 0; panY = 0;
            applyTransform(true);
        }
    });

    // Touch: double-tap zoom + 1-finger pan
    let lastTap = 0;
    mapBox.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTap < 300 && e.changedTouches.length === 1) {
            e.preventDefault();
            mapBox.dispatchEvent(new MouseEvent('dblclick', {
                clientX: e.changedTouches[0].clientX,
                clientY: e.changedTouches[0].clientY
            }));
        }
        lastTap = now;
    });

    let touchStartX, touchStartY, touchPanX, touchPanY;
    mapBox.addEventListener('touchstart', (e) => {
        if (!isZoomed || e.touches.length !== 1) return;
        if (e.target.closest('.map-icon, .tv-player, .tv-enemy, .ttm-mark, button')) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchPanX = panX; touchPanY = panY;
    }, { passive: true });

    mapBox.addEventListener('touchmove', (e) => {
        if (!isZoomed || e.touches.length !== 1) return;
        if (e.target.closest('.map-icon, .tv-player, .tv-enemy, .ttm-mark, button')) return;
        const dx = (e.touches[0].clientX - touchStartX) / ZOOM_LEVEL;
        const dy = (e.touches[0].clientY - touchStartY) / ZOOM_LEVEL;
        panX = touchPanX + dx;
        panY = touchPanY + dy;
        clampPan();
        applyTransform(false);
        e.preventDefault();
    }, { passive: false });
})();
```

### [ ] Bước 3.3: Kiểm tra

- Double-click vào map → zoom 2x vào vị trí click
- Giữ chuột kéo lên → bản đồ đi xuống (inverted pan)
- Double-click lại → reset zoom
- ESC → reset zoom
- Mobile: double-tap zoom, 1 ngón kéo pan

---

## Giai đoạn 4: Timeline Tương Tác + Đồng Bộ Boss/PVP/Rừng

### [ ] Bước 4.1: Nâng cấp tvRenderTimeline() hiển thị boss/pvp/rừng

**File:** `index.html` — hàm `tvRenderTimeline()` (dòng ~2838)

Sửa `SYSTEM_TYPES` để thêm icon chi tiết hơn:

```javascript
const SYSTEM_TYPES = {
    1800: { cls: 'ev-start', label: '🏁 Bắt đầu', icon: '🏁' },
    1500: { cls: 'ev-boss', label: '☀ Boss Vàng phụ', icon: '☀' },
    1200: { cls: 'ev-solo', label: '⚔️ PVP Solo 20:00', icon: '⚔️' },
    900:  { cls: 'ev-boss', label: '🔥 Boss Vàng chính', icon: '🔥' },
    0:    { cls: 'ev-end', label: '🏁 Kết thúc', icon: '🏆' }
};
```

### [ ] Bước 4.2: Thêm hiển thị jungle assignments trên timeline tooltip

Trong vòng lặp render marks (dòng ~2877), mở rộng tooltip:

```javascript
// Sau khi tạo dot, thêm chi tiết vào tooltip
const jungleCount = Object.keys(m.jungle_assignments || {}).length;
const towerCount = Object.values(m.tower_guards || {}).flat().filter(Boolean).length;
let detail = '';
if (jungleCount) detail += ` 🌿${jungleCount}`;
if (towerCount) detail += ` 🏰${towerCount}`;
if (m.pvp_fighters?.blue) detail += ' ⚔️PVP';
dot.innerHTML = `<span class="ttm-tooltip">${tvFormatTime(time)} ${label}${detail}</span>`;
```

### [ ] Bước 4.3: CSS cho timeline tooltip chi tiết hơn

```css
/* ═══ TIMELINE TOOLTIP NÂNG CẤP ═══ */
.ttm-tooltip {
    white-space: nowrap;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(0,0,0,.85);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(251,191,36,.2);
    box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
.ttm-mark.active .ttm-tooltip {
    background: rgba(251,191,36,.15);
    border-color: rgba(251,191,36,.4);
    color: #fde68a;
}
```

### [ ] Bước 4.4: Kiểm tra

- Hover mốc timeline → tooltip hiện đầy đủ (boss, pvp, rừng, trụ)
- Click mốc → player dots animate di chuyển
- Mốc 25:00 hiện ☀ Boss Vàng phụ
- Mốc 20:00 hiện ⚔️ PVP Solo
- Mốc 15:00 hiện 🔥 Boss Vàng chính

---

## Giai đoạn 5: Nút Toàn Màn Hình

### [ ] Bước 5.1: Thêm nút Toàn màn hình vào HTML

**File:** `index.html` — tìm `.map-top` hoặc khu vực nút "Bản đồ" (dòng ~950-960)

Thêm nút bên cạnh nút toggle map:

```html
<button class="map-toggle fullscreen-btn" id="mapFullscreenBtn" onclick="toggleMapFullscreen()">
    ⛶ Toàn màn hình
</button>
```

### [ ] Bước 5.2: CSS cho fullscreen overlay

```css
/* ═══ FULLSCREEN MAP MODE ═══ */
.fs-overlay {
    position: fixed; inset: 0; z-index: 9990;
    background: #060a08;
    display: flex; flex-direction: column;
    opacity: 0; pointer-events: none;
    transition: opacity 0.4s ease;
}
.fs-overlay.active { opacity: 1; pointer-events: all; }

.fs-overlay .fs-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px;
    background: rgba(10,18,12,.95);
    border-bottom: 1px solid rgba(251,191,36,.12);
    backdrop-filter: blur(12px);
    flex-shrink: 0;
}
.fs-overlay .fs-map-area {
    flex: 1; position: relative; overflow: hidden;
}
.fs-overlay .fs-timeline-bar {
    flex-shrink: 0;
    padding: 8px 16px;
    background: rgba(10,18,12,.95);
    border-top: 1px solid rgba(251,191,36,.12);
}
.fs-overlay .fs-tasks-panel {
    position: absolute; left: 0; top: 0; bottom: 0;
    width: 340px; max-width: 90vw;
    background: rgba(10,18,12,.92);
    backdrop-filter: blur(16px);
    border-right: 1px solid rgba(251,191,36,.12);
    overflow-y: auto;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    z-index: 10;
}
.fs-overlay .fs-tasks-panel.open { transform: translateX(0); }
.fs-close-btn {
    background: rgba(255,80,80,.12); border: 1px solid rgba(255,80,80,.25);
    color: #ffb3b3; border-radius: 10px; padding: 6px 14px;
    font-weight: 800; cursor: pointer; font-size: 13px;
}
.fs-tasks-toggle {
    background: rgba(251,191,36,.1); border: 1px solid rgba(251,191,36,.25);
    color: #fde68a; border-radius: 10px; padding: 6px 14px;
    font-weight: 800; cursor: pointer; font-size: 13px;
}

/* Player dots lớn hơn + glow + tên chớp sáng trong fullscreen */
.fs-overlay .tv-player .tv-dot {
    width: 14px; height: 14px;
    box-shadow: 0 0 8px 2px currentColor;
    animation: fsPulse 2s ease-in-out infinite;
}
.fs-overlay .tv-player .tv-label {
    opacity: 1 !important;
    font-size: 11px;
    text-shadow: 0 0 6px currentColor;
    animation: fsBlink 3s ease-in-out infinite;
}
.fs-overlay .tv-player.is-me .tv-dot {
    width: 16px; height: 16px;
    box-shadow: 0 0 12px 4px rgba(251,191,36,.6);
}
@keyframes fsPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.3); }
}
@keyframes fsBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
```

### [ ] Bước 5.3: JS toggleMapFullscreen()

```javascript
// ═══ FULLSCREEN MAP MODE ═══
let _fsOverlay = null;
let _fsTasksOpen = false;

function toggleMapFullscreen() {
    if (_fsOverlay?.classList.contains('active')) {
        exitMapFullscreen();
        return;
    }
    enterMapFullscreen();
}

function enterMapFullscreen() {
    // Tạo overlay nếu chưa có
    if (!_fsOverlay) {
        _fsOverlay = document.createElement('div');
        _fsOverlay.className = 'fs-overlay';
        _fsOverlay.id = 'fsOverlay';
        _fsOverlay.innerHTML = `
            <div class="fs-topbar">
                <button class="fs-tasks-toggle" onclick="toggleFsTasks()">📋 Nhiệm vụ</button>
                <div style="font-weight:800;color:var(--gold);font-size:14px" id="fsTitle">Chiến Thuật</div>
                <button class="fs-close-btn" onclick="exitMapFullscreen()">✕ Đóng</button>
            </div>
            <div class="fs-map-area" id="fsMapArea"></div>
            <div class="fs-timeline-bar" id="fsTimelineBar"></div>
            <div class="fs-tasks-panel" id="fsTasksPanel"></div>
        `;
        document.body.appendChild(_fsOverlay);
    }

    // Clone map content vào fullscreen
    const mapBox = document.getElementById('mapBox');
    const fsMapArea = document.getElementById('fsMapArea');
    const fsTimeline = document.getElementById('fsTimelineBar');

    if (mapBox) {
        fsMapArea.innerHTML = mapBox.innerHTML;
    }

    // Clone timeline
    const timeline = document.getElementById('tacticsTimeline');
    if (timeline) {
        fsTimeline.innerHTML = timeline.innerHTML;
    }

    // Clone tasks
    const tasksContent = document.getElementById('tasksTabContent');
    const fsTasksPanel = document.getElementById('fsTasksPanel');
    if (tasksContent) {
        fsTasksPanel.innerHTML = tasksContent.innerHTML;
    }

    // Activate
    _fsOverlay.classList.add('active');

    // Fullscreen API
    try {
        document.documentElement.requestFullscreen?.() ||
        document.documentElement.webkitRequestFullscreen?.();
    } catch(e) {}

    // Mobile: thử lock landscape
    try { screen.orientation.lock('landscape').catch(() => {}); } catch(e) {}

    // Re-apply map icons position
    requestAnimationFrame(() => {
        updateMapIconsPosition();
        if (_tvTacticsData) tvRenderMark(_tvActiveMarkIdx);
    });
}

function exitMapFullscreen() {
    if (_fsOverlay) _fsOverlay.classList.remove('active');
    _fsTasksOpen = false;

    // Exit fullscreen API
    try {
        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    } catch(e) {}

    // Unlock orientation
    try { screen.orientation.unlock?.(); } catch(e) {}
}

function toggleFsTasks() {
    _fsTasksOpen = !_fsTasksOpen;
    document.getElementById('fsTasksPanel')?.classList.toggle('open', _fsTasksOpen);
}

// ESC listener cho fullscreen
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && _fsOverlay?.classList.contains('active')) {
        exitMapFullscreen();
    }
});
```

### [ ] Bước 5.4: Kiểm tra Fullscreen

- Bấm nút "⛶ Toàn màn hình" → map full viewport
- Player dots lớn hơn, tên chớp sáng
- Timeline ở dưới cùng, click mốc vẫn hoạt động
- Bấm 📋 → panel nhiệm vụ slide-in từ trái
- ESC hoặc ✕ → thoát fullscreen
- Mobile: bật fullscreen → quay ngang

---

## Giai đoạn 6: Redesign UI Premium

### [ ] Bước 6.1: CSS nâng cấp timeline track

```css
/* ═══ TIMELINE REDESIGN ═══ */
.tactics-timeline-mini {
    background: linear-gradient(180deg, rgba(10,18,12,.95), rgba(8,14,10,.98));
    border: 1px solid rgba(251,191,36,.1);
    border-radius: 14px;
    padding: 12px 16px;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 32px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.03);
}

/* Mark dots glow effect */
.ttm-mark::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: radial-gradient(circle, currentColor, transparent 70%);
    opacity: 0;
    transition: opacity 0.3s;
}
.ttm-mark:hover::before,
.ttm-mark.active::before { opacity: 0.3; }
.ttm-mark.active { transform: scale(1.4); }
```

### [ ] Bước 6.2: CSS nâng cấp controls bar

```css
/* ═══ TACTICS CONTROLS GLASSMORPHISM ═══ */
.tactics-controls {
    background: rgba(10,18,12,.85);
    backdrop-filter: blur(16px) saturate(1.2);
    border: 1px solid rgba(251,191,36,.08);
    border-radius: 14px;
    box-shadow: 0 4px 24px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.02);
}
```

### [ ] Bước 6.3: Map vignette overlay

```css
/* ═══ MAP VIGNETTE ═══ */
.map-box::after {
    content: '';
    position: absolute; inset: 0;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 0 60px rgba(0,0,0,.3);
    z-index: 5;
}
```

### [ ] Bước 6.4: Kiểm tra

- Timeline track có glassmorphism blur
- Mark dots glow khi hover/active
- Map có subtle vignette ở viền
- Controls bar trong suốt mờ đẹp

---

## Giai đoạn 7: Mobile Responsive Bổ Sung

### [ ] Bước 7.1: CSS mobile cho fullscreen

```css
@media (max-width: 768px) {
    .fs-overlay .fs-tasks-panel {
        width: 100%; height: 45vh;
        top: auto; bottom: 0;
        transform: translateY(100%);
        border-right: none;
        border-top: 1px solid rgba(251,191,36,.15);
    }
    .fs-overlay .fs-tasks-panel.open { transform: translateY(0); }

    .fs-overlay .fs-topbar { padding: 6px 10px; }
    .fs-close-btn, .fs-tasks-toggle { font-size: 12px; padding: 5px 10px; }
}

@media (max-width: 768px) and (orientation: landscape) {
    .fs-overlay .fs-tasks-panel {
        width: 280px; height: 100%;
        top: 0; bottom: 0;
        transform: translateX(-100%);
        border-top: none;
        border-right: 1px solid rgba(251,191,36,.15);
    }
    .fs-overlay .fs-tasks-panel.open { transform: translateX(0); }
}
```

### [ ] Bước 7.2: Thêm landscape overlay cho mobile

Khi mobile portrait bấm fullscreen, hiện overlay nhắc xoay ngang:

```javascript
// Trong enterMapFullscreen(), thêm:
if (window.matchMedia('(max-width: 768px) and (orientation: portrait)').matches) {
    // Thêm hint xoay ngang
    const rotateHint = document.createElement('div');
    rotateHint.id = 'fsRotateHint';
    rotateHint.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(6,10,8,.97);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#fde68a;font-size:18px;font-weight:800;';
    rotateHint.innerHTML = '<div style="font-size:48px;animation:rotateHint 2s ease-in-out infinite">📱↪️</div><div>Xoay ngang điện thoại</div>';
    _fsOverlay.appendChild(rotateHint);

    // Tự ẩn khi xoay xong
    const mql = window.matchMedia('(orientation: landscape)');
    const handler = (e) => {
        if (e.matches) { rotateHint.remove(); mql.removeEventListener('change', handler); }
    };
    mql.addEventListener('change', handler);
}
```

### [ ] Bước 7.3: Kiểm tra mobile

- Chrome DevTools → Toggle Device → chọn iPhone 14 Pro
- Bấm fullscreen → hiện hint xoay ngang
- Xoay landscape → hint ẩn, map full viewport
- Panel nhiệm vụ slide-up từ dưới (portrait) hoặc slide-in trái (landscape)

---

## Giai đoạn 8: Tạo Workflow + Hoàn thiện

### [ ] Bước 8.1: Test toàn bộ flow trên Desktop

1. Mở index.html → không có thanh cuộn ngang
2. Vào session có chiến thuật → map review hiện tự động
3. Double-click map → zoom 2x
4. Giữ kéo → pan
5. Click mốc timeline → animate player dots
6. Hover mốc → tooltip chi tiết (boss/pvp/rừng)
7. Bấm fullscreen → full viewport + glow dots
8. ESC → thoát

### [ ] Bước 8.2: Test trên Mobile (DevTools)

1. iPhone mode → no horizontal scroll
2. Double-tap zoom → pan 1 ngón
3. Fullscreen → landscape hint
4. Xoay ngang → map full screen + timeline ở dưới

### [ ] Bước 8.3: Gửi lên Discord test thật (nếu cần)

```
/GuiDiscord
```

---

## Lưu ý quan trọng

1. **Backup trước khi sửa** — File index.html ~3210 dòng, sửa cẩn thận
2. **Không xoá code cũ** — Chỉ thêm mới hoặc wrap/extend
3. **Test từng giai đoạn** — Hoàn thành 1 giai đoạn → test → sang giai đoạn tiếp
4. **CSS thêm cuối** — Tất cả CSS mới thêm vào cuối `<style>` tag
5. **JS thêm cuối** — Tất cả JS mới thêm trước `</script>` tag
6. **Realtime không ảnh hưởng** — Các thay đổi UI-only, không đụng đến Supabase logic
