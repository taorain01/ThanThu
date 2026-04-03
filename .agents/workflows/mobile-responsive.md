---
description: Tích hợp giao diện Mobile Responsive cho hệ thống web Bang Chiến (index, team_editor, tactics) — Cuốn chiếu từng trang, Touch Drag & Drop, Landscape Fullscreen Mode
---

# Workflow: Mobile Responsive — Bang Chiến Web

## Tổng quan

```
Giai đoạn 1: team_editor.html  →  Responsive + SortableJS Touch DnD
Giai đoạn 2: index.html        →  Bottom Tab Navigation + Map Pinch Zoom
Giai đoạn 3: tactics.html      →  Landscape Fullscreen Map Mode + Floating Toolbox
Giai đoạn 4: PWA Manifest      →  Add to Home Screen (icon app)
```

**Nguyên tắc chung:**
- Breakpoint chính: `@media (max-width: 768px)` cho mobile
- Breakpoint landscape: `@media (max-width: 960px) and (orientation: landscape)` cho tactics
- Không ảnh hưởng Desktop (tất cả thay đổi nằm trong `@media`)
- Test bằng Chrome DevTools (Toggle Device) + gửi lên Discord bằng `/GuiDiscord` để test điện thoại thật

---

## Giai đoạn 1: Mobile hóa `team_editor.html`

### Bước 1.1: Thêm SortableJS CDN

Thêm vào `<head>` của `web/team_editor.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
```

### Bước 1.2: Thêm CSS responsive cho mobile

Thêm block `@media (max-width: 768px)` vào cuối `<style>` trong `team_editor.html`:

```css
@media (max-width: 768px) {
  /* Topbar: gom compact */
  .topbar { flex-wrap: wrap; padding: 10px 12px; gap: 8px; position: sticky; top: 0; z-index: 20 }
  .back-link { padding: 8px 10px; font-size: 11px }
  .title-wrap .title { font-size: 16px }
  .title-wrap .sub { font-size: 11px }
  .toolbar { flex: 1 0 100%; justify-content: center; gap: 6px }
  .toolbar .btn { font-size: 11px; padding: 8px 10px }
  .toolbar .badge { font-size: 11px; padding: 6px 10px }

  /* Content: 1 cột dọc thay vì 2 cột */
  .content { grid-template-columns: 1fr; padding: 10px; gap: 10px }
  .teams-grid { grid-template-columns: 1fr; gap: 10px }

  /* Panel body: padding thu nhỏ */
  .panel-head { padding: 10px 12px }
  .panel-body { padding: 8px }

  /* Member row: touch-friendly size */
  .member-row { padding: 10px; gap: 8px; min-height: 48px }
  .member-name { font-size: 14px }
  .kick-btn, .leader-btn { min-width: 36px; min-height: 36px; font-size: 14px }

  /* Split nav button: nhỏ lại */
  .split-btn { height: 32px }
  .split-side > span { font-size: 10px; letter-spacing: 0.3px }

  /* Hàng chờ: đẩy xuống dưới */
  .right-col { order: 2 }
}
```

### Bước 1.3: Thay thế HTML5 Drag & Drop bằng SortableJS

Trong phần `<script>` của `team_editor.html`, thay đổi hàm `setupDropZone()` và `renderEditor()`:

```javascript
// Thay thế hàm setupDropZone cũ
function setupDropZone(node, teamKey) {
  if (!node || !isLeaderEditor || localState.locked) return;
  const body = node.querySelector('.panel-body') || node;

  // Hủy Sortable cũ nếu có
  if (body._sortable) body._sortable.destroy();

  body._sortable = new Sortable(body, {
    group: 'teams',           // Cho phép kéo giữa các team
    animation: 180,
    delay: 150,               // Touch hold 150ms trước khi kéo
    delayOnTouchOnly: true,   // Chỉ delay trên touch, mouse vẫn kéo ngay
    ghostClass: 'dragging',
    chosenClass: 'drag-chosen',
    dragClass: 'drag-active',
    handle: '.drag-handle',   // Chỉ kéo khi chạm vào handle
    fallbackOnBody: true,
    swapThreshold: 0.65,
    onEnd: function(evt) {
      const userId = evt.item.dataset.userId;
      const fromTeam = evt.from.closest('[data-team]')?.dataset.team;
      const toTeam = evt.to.closest('[data-team]')?.dataset.team;
      if (!fromTeam || !toTeam || fromTeam === toTeam) return;

      moveMember(userId, fromTeam, toTeam);
      renderEditor();
      scheduleSync('Đang đồng bộ thay đổi đội hình...');
    }
  });
}
```

### Bước 1.4: Viewport meta

Đảm bảo `<meta name="viewport">` có dạng:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

### Bước 1.5: Test

1. Mở Chrome DevTools → Toggle Device Toolbar → chọn iPhone 14 Pro hoặc Galaxy S21
2. Kiểm tra layout 1 cột
3. Kiểm tra kéo thả bằng touch simulation
4. Kiểm tra sync Supabase sau khi kéo thả
5. Gửi lên Discord bằng `/GuiDiscord` để test trên đt thật

---

## Giai đoạn 2: Mobile hóa `index.html`

### Bước 2.1: Thêm Bottom Navigation Bar HTML

Thêm vào cuối `.app` div (trước `.footer`):

```html
<div class="mobile-nav" id="mobileNav">
  <div class="mob-tab active" data-target="mob-teams" onclick="switchMobileTab(this)">👥<span>Đội hình</span></div>
  <div class="mob-tab" data-target="mob-map" onclick="switchMobileTab(this)">🗺️<span>Bản đồ</span></div>
  <div class="mob-tab" data-target="mob-tasks" onclick="switchMobileTab(this)">📋<span>Nhiệm vụ</span></div>
</div>
```

### Bước 2.2: CSS cho Bottom Nav + Mobile Layout

```css
@media (max-width: 768px) {
  /* Ẩn footer desktop, thay bằng bottom nav */
  .footer { display: none }
  .mobile-nav { display: flex !important }

  /* Header gọn */
  .header { padding: 8px 12px; gap: 8px }
  .guild-name { font-size: 22px; letter-spacing: 2px }
  .header-info { display: none }
  .guild-emblem { width: 36px; height: 36px }

  /* Day bar: scroll ngang */
  .day-bar { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 8px 10px }
  .day-tab { white-space: nowrap; font-size: 12px; padding: 6px 14px }
  .day-sep, .day-add { flex-shrink: 0 }

  /* Main layout: 1 cột */
  .main { grid-template-columns: 1fr; overflow-y: auto }
  .main::before { display: none }
  .left { display: none; padding: 8px; border-right: none }
  .right { display: none }

  /* Active mobile tab views */
  .left.mob-active { display: block }
  .right.mob-active { display: flex }

  /* Map full width */
  .map-box { min-height: 50vh; border-radius: 0 }

  /* Mobile bottom nav */
  .mobile-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
    display: none; /* Ẩn trên desktop */
    background: rgba(10,18,12,.96); border-top: 1px solid rgba(34,197,94,.15);
    backdrop-filter: blur(12px); padding: 6px 0;
    padding-bottom: env(safe-area-inset-bottom, 6px); /* Safe area cho iPhone notch */
  }
  .mob-tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 6px 0; font-size: 18px; color: var(--text3); cursor: pointer;
    transition: color 0.2s;
  }
  .mob-tab span { font-size: 9px; font-weight: 600 }
  .mob-tab.active { color: var(--gold) }

  /* Split button nhỏ lại */
  .split-btn { height: 34px }
  .split-side > span { font-size: 10px }

  /* Tabs header: gọn */
  .r-tabs { padding: 8px 10px 0; gap: 4px }
  .r-tab { padding: 6px 12px; font-size: 11px }
}
```

### Bước 2.3: JS switchMobileTab

```javascript
function switchMobileTab(el) {
  document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const target = el.dataset.target;

  const left = document.getElementById('leftPanel');
  const right = document.querySelector('.right');
  left.classList.remove('mob-active');
  right.classList.remove('mob-active');

  if (target === 'mob-teams') left.classList.add('mob-active');
  else if (target === 'mob-map' || target === 'mob-tasks') right.classList.add('mob-active');
}
```

### Bước 2.4: Map tooltip touch

```javascript
// Thêm vào cuối phần map icons init
if ('ontouchstart' in window) {
  document.querySelectorAll('.map-icon').forEach(icon => {
    icon.addEventListener('touchstart', (e) => {
      // Tắt tất cả tooltip khác
      document.querySelectorAll('.map-icon-tooltip').forEach(t => t.style.opacity = '0');
      // Bật tooltip của icon này
      const tooltip = icon.querySelector('.map-icon-tooltip');
      if (tooltip) tooltip.style.opacity = tooltip.style.opacity === '1' ? '0' : '1';
    });
  });
}
```

---

## Giai đoạn 3: Landscape Fullscreen Mode cho `tactics.html`

### Bước 3.1: Overlay cảnh báo xoay ngang

Thêm HTML vào cuối `<body>`:

```html
<div class="landscape-warning" id="landscapeWarning">
  <div class="lw-content">
    <div class="lw-icon">📱↪️</div>
    <div class="lw-text">Xoay ngang điện thoại<br>để xem sa bàn chiến thuật</div>
    <div class="lw-hint">Hoặc bấm nút bên dưới để vào chế độ toàn màn hình</div>
    <button class="lw-btn" onclick="enterFullscreenLandscape()">🔄 Vào chế độ toàn màn hình</button>
  </div>
</div>
```

### Bước 3.2: CSS Landscape Warning + Fullscreen Map

```css
/* Portrait trên mobile → hiện warning */
@media (max-width: 768px) and (orientation: portrait) {
  .landscape-warning {
    display: flex !important;
    position: fixed; inset: 0; z-index: 9999;
    align-items: center; justify-content: center;
    background: rgba(10,18,12,.98); text-align: center; color: var(--gold);
  }
  .t-header, .t-layout, .timeline-bar { display: none !important }
}

/* Landscape trên mobile → fullscreen map */
@media (max-width: 960px) and (orientation: landscape) {
  .landscape-warning { display: none !important }
  .t-header { display: none }
  .t-layout { height: 100vh }
  .panel-left, .panel-right { display: none }
  .timeline-bar { 
    height: auto; padding: 4px 8px;
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
    background: rgba(10,18,12,.95); border-top: 1px solid rgba(251,191,36,.2);
  }

  /* Floating buttons */
  .mobile-map-toolbar {
    position: fixed; top: 8px; right: 8px; z-index: 60;
    display: flex; gap: 6px;
  }
  .mobile-drawer-btn {
    position: fixed; top: 8px; left: 8px; z-index: 60;
  }

  /* Drawer slide-in */
  .mobile-drawer {
    position: fixed; top: 0; left: -280px; width: 280px; height: 100vh;
    background: rgba(10,18,12,.96); border-right: 1px solid var(--border);
    z-index: 70; transition: left 0.3s ease; overflow-y: auto;
    backdrop-filter: blur(12px);
  }
  .mobile-drawer.open { left: 0 }
  .mobile-drawer-backdrop {
    position: fixed; inset: 0; z-index: 65;
    background: rgba(0,0,0,.4); display: none;
  }
  .mobile-drawer-backdrop.show { display: block }
}

.landscape-warning { display: none }
.lw-icon { font-size: 64px; margin-bottom: 16px; animation: rotateHint 2s ease-in-out infinite }
.lw-text { font-size: 18px; font-weight: 700; margin-bottom: 8px }
.lw-hint { font-size: 12px; color: var(--text2); margin-bottom: 16px }
.lw-btn { padding: 10px 24px; border-radius: 12px; border: 1px solid var(--gold);
  background: rgba(251,191,36,.1); color: var(--gold); font-size: 14px; font-weight: 700;
  cursor: pointer; font-family: inherit }
@keyframes rotateHint { 0%,100% { transform: rotate(0) } 50% { transform: rotate(90deg) } }
```

### Bước 3.3: JS Fullscreen API

```javascript
function enterFullscreenLandscape() {
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  // Thử ép xoay ngang
  try { screen.orientation.lock('landscape').catch(() => {}); } catch(e) {}
}
```

### Bước 3.4: Touch Events cho Map

```javascript
// Tách biệt: 1 ngón trên map trống = Pan, 1 ngón trên icon = Move icon, 2 ngón = Zoom
function setupMobileTouchMap() {
  const mapArea = document.querySelector('.map-area');
  let touchTarget = null;
  let isPanning = false;

  mapArea.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      // 2 ngón → Pinch zoom (để browser/panzoom xử lý)
      return;
    }
    const target = e.target.closest('.map-player, .map-enemy');
    if (target) {
      // Chạm vào icon người → chuẩn bị kéo
      touchTarget = target;
      e.preventDefault();
    } else {
      // Chạm map trống → pan
      isPanning = true;
    }
  }, { passive: false });

  mapArea.addEventListener('touchmove', (e) => {
    if (touchTarget && e.touches.length === 1) {
      // Kéo icon theo ngón tay
      const touch = e.touches[0];
      // ... tính toạ độ % trên map và update vị trí
      e.preventDefault();
    }
  }, { passive: false });

  mapArea.addEventListener('touchend', (e) => {
    if (touchTarget) {
      // Thả icon → lưu vị trí mới
      touchTarget = null;
    }
    isPanning = false;
  });
}
```

---

## Giai đoạn 4: PWA Manifest

### Bước 4.1: Tạo file `web/manifest.json`

```json
{
  "name": "Lang Gia - Bang Chiến",
  "short_name": "Lang Gia",
  "description": "Hệ thống quản lý bang chiến Guild Lang Gia",
  "start_url": "/index.html",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0a1a0f",
  "theme_color": "#0a1a0f",
  "icons": [
    { "src": "./anh/langgia_icon.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./anh/langgia_icon.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Bước 4.2: Thêm meta tags vào cả 3 trang HTML

```html
<link rel="manifest" href="./manifest.json">
<meta name="theme-color" content="#0a1a0f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="./anh/langgia_icon.png">
```

---

## Lưu ý quan trọng

1. **Không bao giờ xoá code Desktop** — tất cả thay đổi mobile nằm trong `@media` query.
2. **SortableJS** phải init SAU khi render DOM xong (gọi trong `renderEditor()`).
3. **Safe Area iOS**: Dùng `env(safe-area-inset-bottom)` cho bottom nav/toolbar để tránh bị notch che.
4. **Test thật**: Sau mỗi giai đoạn, dùng workflow `/GuiDiscord` gửi file lên Discord rồi mở trên đt.
5. **Thứ tự file thay đổi**: `team_editor.html` → `index.html` → `tactics.html` → tạo `manifest.json`.
6. **Supabase Realtime**: Không ảnh hưởng — mobile browser hỗ trợ WebSocket bình thường.
