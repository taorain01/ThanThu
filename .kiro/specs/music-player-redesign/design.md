# Design Document — Redesign Music Player

## Overview

Tài liệu này mô tả thiết kế redesign cho music player (`#mpWrap`) trong `WebBangChien/index.html`. Mục tiêu: làm giao diện hiện đại, gọn, phân cấp rõ ràng hơn, vẫn giữ DNA thị giác của Lang Gia (xanh rêu sâu + nhấn vàng kim, glassmorphism) và **giữ nguyên 100% chức năng** đang chạy.

### Định hướng đã chốt (giả định khi bạn nói "làm đi")
- **Q1 — Phong cách:** Giữ phong cách hiện tại nhưng *tinh chỉnh & hiện đại hóa* (refine, không lật đổ). Bo góc mềm vừa, glass tinh tế, giảm độ "chói" của gold, tăng phân cấp.
- **Q2 — Mini bar:** Giữ đủ nút nhưng *sắp xếp lại cho gọn & cân*; nhấn mạnh nút play (trạng thái đang phát).
- **Q3 — Artwork:** Giữ đĩa vinyl giả lập làm mặc định, nhưng thiết kế *hỗ trợ ảnh bìa thật* nếu sau này có dữ liệu (slot ảnh tùy chọn). Không bắt buộc ở vòng này.

> Nếu bạn muốn đổi bất kỳ giả định nào, mình cập nhật lại design trước khi sang tasks.

### Ràng buộc chính
- Đây là file HTML đơn (`WebBangChien/index.html`) với CSS inline trong `<style>` và JS inline trong `<script>`. Không có bước build.
- **Phải giữ nguyên các `id`** mà JS đang bind (xem mục "Hợp đồng với JavaScript"). Đổi class CSS thì tự do, đổi id thì phải sửa JS đồng bộ.
- Không đổi logic phát nhạc, nguồn dữ liệu, danh sách bài.

---

## Architecture

### Cấu trúc trạng thái (giữ nguyên)
```
#mpWrap (.mp-wrap)
├── trạng thái: .collapsed | (expanded) | .mp-closed | .mp-dragging | .mp-mobile-docked
├── .mp-mini-bar              ← luôn hiển thị
│   ├── #mpCollapseBtn (.mp-collapse-btn)   mũi tên thu/mở
│   ├── #mpMiniTrack  (.mp-mini-track)      tên bài
│   ├── #mpMiniAutoplay (.mp-mini-autoplay) toggle autoplay (mini)
│   ├── #mpMiniPlay   (.mp-mini-play)       play/pause (mini)
│   ├── #mpMiniExpand (.mp-mini-expand)     mở full
│   └── #mpCloseBtn   (.mp-close-btn)       đóng (X)
└── .mp-body                  ← ẩn khi collapsed
    ├── .mp-tabs (#mpTab0, #mpTab1)         playlist tabs
    ├── .mp-art-row (#mpDisc, #mpTname, #mpTpl, #mpTidx)
    ├── .mp-eq (#mpEq)                       EQ visualizer
    ├── .mp-prog-wrap (#mpProgTrack, #mpProgFill, #mpTcur, #mpTtot)
    ├── .mp-ctrls (#mpShuf, prev, #mpPlayBtn, next, #mpRep)
    ├── .mp-vol (#mpVolSl, #mpVolLbl)
    ├── .mp-autoplay (#mpAutoplay)
    └── .mp-list-btn + .mp-list (#mpList, #mpListCnt)
```

Redesign **không thay đổi cây DOM/state machine** — chỉ thay đổi CSS (layout, màu, spacing, animation) và các điều chỉnh markup nhỏ không phá vỡ id/hành vi.

### Hợp đồng với JavaScript (id bắt buộc giữ)
Các id sau đang được JS bind sự kiện/cập nhật nội dung — **không được xóa/đổi** (nếu đổi phải sửa JS):

`mpAudio, mpWrap, mpMiniBar, mpCollapseBtn, mpMiniTrack, mpMiniAutoplay, mpMiniPlay, mpMiniExpand, mpCloseBtn, mpTab0, mpTab1, mpDisc, mpTname, mpTpl, mpTidx, mpEq, mpProgTrack, mpProgFill, mpTcur, mpTtot, mpShuf, mpPlayBtn, mpRep, mpVolSl, mpVolLbl, mpAutoplay, mpListArrow, mpListCnt, mpList`

Các handler inline (`mpToggleCollapse`, `mpTogglePlay`, `mpPrev`, `mpNext`, `mpToggleShuf`, `mpToggleRep`, `mpSetVol`, `mpSetAutoplay`, `mpSwitchPl`, `mpToggleList`, `mpClosePlayer`, `mpToggleAutoplayMini`) cũng giữ nguyên.

---

## Design Tokens (biến hệ thống)

Thêm một nhóm biến cục bộ cho player (đặt trong `:root` hoặc scope `.mp-wrap`) để dễ tinh chỉnh, tái dùng biến gold/green hiện có:

| Token | Giá trị đề xuất | Vai trò |
|-------|-----------------|---------|
| `--mp-radius` | `18px` | bo góc khối chính |
| `--mp-radius-sm` | `10px` | bo góc nút/thẻ con |
| `--mp-glass-bg` | `linear-gradient(135deg, rgba(8,22,14,.90), rgba(10,24,16,.94))` | nền glass |
| `--mp-border` | `rgba(200,162,44,.18)` | viền mảnh vàng dịu |
| `--mp-gold` | `var(--gold)` | nhấn chính |
| `--mp-gold-soft` | `rgba(200,162,44,.55)` | nhấn phụ |
| `--mp-text` | `#eef0e6` | chữ chính |
| `--mp-text-dim` | `rgba(238,240,230,.55)` | chữ phụ |
| `--mp-shadow` | `0 18px 50px rgba(0,0,0,.6)` | đổ bóng khối |
| `--mp-focus` | `0 0 0 2px rgba(200,162,44,.7)` | ring focus |

Nguyên tắc: giảm số lượng gradient gold chồng lớp đang gây "chói"; ưu tiên 1 lớp nền glass + 1 viền mảnh + 1 điểm nhấn gold cho phần tử active.

---

## Components and Interfaces

### Mini Bar — Thiết kế mới

**Mục tiêu:** một dải pill cân đối, đọc nhanh "đang phát gì", thao tác play tức thì.

Bố cục (trái → phải):
```
[▾ collapse]  [ ♪ Tên bài ......... ]  [autoplay]  [ ▶/⏸ play ]  [✕]
```
- **Khi collapsed:** chỉ hiện `[▶/⏸]` + `[▾ mở]` (ẩn tên + autoplay + X như hành vi hiện tại) → pill siêu gọn ~ 110–122px.
- **Khi expanded:** mini bar thành "header" của full player: hiện tên bài + nút play + X; collapse arrow xoay.
- **Nút play** là điểm nhấn chính: nền gold dịu, viền sáng; khi `playing` có glow đập nhẹ (giữ animation `mpPlayGlow` nhưng giảm cường độ ~30%).
- Touch target mỗi nút ≥ 32px. Khoảng cách nút đều (gap 6–8px).

Tinh chỉnh thị giác:
- Bỏ bớt viền/độ bóng thừa, dùng 1 lớp glass + viền `--mp-border`.
- Tên bài: `mp-mini-track` dùng `--mp-text-dim`, ellipsis 1 dòng.

### Full Player — Thiết kế mới

**Phân cấp dọc rõ ràng** (đáp ứng Requirement 3.1):

```
┌─────────────────────────────────────┐
│ MINI BAR (header): ♪ tên · ⏸ · ✕     │  ← luôn ở trên
├─────────────────────────────────────┤
│ [ Lang Gia OST ] [ EDM Drop ]        │  tabs (segmented)
│                                       │
│  ◎ disc/artwork   Tên bài (lớn)       │  art-row
│                   Lang Gia OST        │
│                   Bài 6 / 19          │
│                                       │
│  ▁▃▅▂▆▃▁ EQ visualizer                │
│  ───────●───────  1:07 / 3:02         │  progress + time
│                                       │
│     🔀   ⏮   ( ⏸ )   ⏭   🔁           │  controls
│                                       │
│  🔊 ──────●──────                      │  volume
│  ◗ Tự động phát nhạc                   │  autoplay toggle
│  ▾ Danh sách (19 bài)                 │  list toggle
└─────────────────────────────────────┘
```

Chi tiết:
- **Tabs:** kiểu "segmented control" — 2 tab dính nhau trong 1 nền pill, tab active nền gold dịu, tab thường trong suốt. Rõ ràng hơn 2 nút rời.
- **Art-row:** đĩa `#mpDisc` giữ hiệu ứng quay khi phát; thiết kế hỗ trợ `background-image` ảnh bìa thật (nếu có) phủ lên đĩa. Tên bài cỡ lớn (đậm), playlist + index nhỏ dần (dim).
- **EQ:** giữ cột, đổi sang gradient gold mảnh hơn, đỉnh bo nhẹ; số cột & animation giữ nguyên (JS điều khiển `#mpEq`).
- **Progress:** track mảnh, fill gradient gold, có thumb tròn xuất hiện khi hover/seek; thời gian 2 đầu dùng `--mp-text-dim`, dùng `tabular-nums` cho số.
- **Controls:** nút play trung tâm to & nổi (gold), 4 nút phụ (shuffle/prev/next/repeat) đồng cỡ, trạng thái active (shuffle/repeat bật) tô gold.
- **Volume:** slider mảnh, thumb gold; icon loa bên trái.
- **Autoplay & list:** giữ toggle + nút danh sách; danh sách `#mpList` giữ cơ chế popover hiện có (trái/phải/trên/dưới tùy vị trí).

### States & Interactions

| Trạng thái | Class | Xử lý visual |
|-----------|-------|--------------|
| Thu gọn | `.collapsed` | ẩn `.mp-body`, pill gọn, chỉ play + arrow |
| Mở rộng | (mặc định) | hiện `.mp-body`, arrow xoay 180° |
| Đang phát | `.playing` trên nút play | glow đập nhẹ (giảm cường độ) |
| Đóng | `.mp-closed` | fade + scale out (giữ nguyên) |
| Kéo thả | `.mp-dragging` | tắt transition + tắt hiệu ứng hover (giữ nguyên) |
| Dock mobile | `.mp-mobile-docked` | layout gọn theo media query hiện có |

Hover/active/focus thống nhất: nút phụ hover → sáng nhẹ + nền `rgba(gold,.12)`; focus-visible → ring `--mp-focus`.

## Responsive & Drag

- Giữ logic kéo thả JS hiện tại (không sửa). Chỉ đảm bảo CSS mới không chặn `pointer-events` ở vùng kéo (`.mp-mini-bar`).
- Mobile: giữ media query `.mp-wrap.mp-mobile-docked`; full player giới hạn `width: min(280px, calc(100vw - 16px))` và `max-height` cuộn được.
- Đảm bảo các nút điều khiển có `pointer-events` riêng để kéo thả không bấm nhầm (đã có `POINTER_IGNORE_SELECTORS` trong JS — giữ nguyên selector hoặc cập nhật nếu đổi class).

## Accessibility

- Mọi nút icon-only giữ/`title` + thêm `aria-label` nếu thiếu.
- `#mpCollapseBtn` → `aria-expanded` phản ánh collapsed/expanded.
- `#mpMiniAutoplay` & `#mpAutoplay` → `aria-pressed`/`checked` đồng bộ trạng thái.
- Thêm `:focus-visible` ring (`--mp-focus`) cho tất cả control.
- Tab playlist dùng `role="tab"`/`aria-selected` (tùy chọn nâng cao).

## Data Models

Redesign này thuần UI nên không có schema dữ liệu mới. Để thống nhất, "trạng thái hiển thị" của player được mô tả như một mô hình khái niệm (do JS hiện có quản lý, CSS chỉ phản ánh qua class):

```
PlayerViewState {
  collapsed:    boolean   → .mp-wrap.collapsed
  playing:      boolean   → .mp-mini-play.playing / #mpPlayBtn (icon)
  closed:       boolean   → .mp-wrap.mp-closed
  dragging:     boolean   → .mp-wrap.mp-dragging
  mobileDocked: boolean   → .mp-wrap.mp-mobile-docked
  listOpen:     boolean   → .mp-wrap.mp-list-open / .mp-list.open
  activePlaylist: 0 | 1   → .mp-tab.active (#mpTab0 | #mpTab1)
  autoplay:     boolean   → #mpAutoplay.checked / .mp-mini-autoplay.on
  volume:       0..100    → #mpVolSl.value (--vp%)
  progress:     0..100%   → #mpProgFill width
}

TrackInfo (hiển thị, do JS đổ vào) {
  name:     string → #mpTname / #mpMiniTrack
  playlist: string → #mpTpl
  index:    "Bài x / y" → #mpTidx
  artwork?: url (tùy chọn, vòng sau) → background-image của #mpDisc
}
```

Redesign **không** thêm/đổi field dữ liệu; chỉ thêm slot artwork tùy chọn (không bắt buộc).

## Correctness Properties

Vì đây là redesign CSS/markup, các thuộc tính đúng đắn tập trung vào **bất biến hành vi & cấu trúc**:

### Property 1: Bảo toàn id
Mọi id trong "Hợp đồng với JavaScript" vẫn tồn tại đúng 1 lần trong DOM sau redesign.

**Validates: Requirements 1.2**

### Property 2: Bảo toàn handler
Mọi `onclick`/`oninput` inline cũ vẫn gọi đúng tên hàm cũ (hoặc hàm tương đương đã được nối lại).

**Validates: Requirements 1.1, 1.3**

### Property 3: Toàn vẹn trạng thái
Với mọi tổ hợp class trạng thái hợp lệ (`collapsed`, `playing`, `mp-closed`, `mp-dragging`, `mp-mobile-docked`), player render không lỗi layout (không tràn khỏi viewport theo chiều ngang).

**Validates: Requirements 3.3**

### Property 4: Touch target
Mọi nút bấm trong mini bar có kích thước hiển thị ≥ 32×32px ở desktop.

**Validates: Requirements 2.3**

### Property 5: Không vỡ ở màn hẹp
Ở `width` 320px, full player không gây overflow ngang của trang.

**Validates: Requirements 3.3, 5.2**

## Error Handling

- **Thiếu phần tử DOM:** Nếu một id bị đổi nhầm khiến JS không tìm thấy phần tử, các hàm `getElementById(...)` sẽ trả `null`. Giảm thiểu bằng cách giữ nguyên id (P1) và rà soát trước khi commit.
- **Ảnh bìa lỗi (nếu bật artwork):** `#mpDisc` phải fallback về đĩa vinyl giả lập khi ảnh không load (dùng `onerror` hoặc giữ nền gradient mặc định dưới ảnh).
- **Theme sáng:** Mọi màu mới phải có nhánh `body:not(.theme-dark)` hoặc dùng biến để không bị mất tương phản ở theme sáng.
- **Animation nặng:** Nếu thiết bị yếu, ưu tiên `transform/opacity`; tránh animate `box-shadow` liên tục gây giật.

## Testing Strategy

- **Kiểm thử cấu trúc (P1, P2):** đoạn kiểm tra liệt kê toàn bộ id trong "Hợp đồng JS" và xác nhận tồn tại đúng 1 lần; rà soát các `onclick/oninput` còn trỏ đúng hàm.
- **Kiểm thử layout (P3, P5):** mở local server, kiểm tra ở các breakpoint (≥1280px, ~768px, 320px) cho từng tổ hợp trạng thái (thu gọn/mở rộng, đang phát, list mở) — không tràn ngang, không chồng chữ.
- **Kiểm thử touch target (P4):** đo kích thước render các nút mini bar ≥ 32px.
- **Kiểm thử hành vi:** bấm thử play/pause, prev/next, shuffle, repeat, volume, autoplay, đổi tab, mở danh sách, kéo thả, đóng — đối chiếu hoạt động như trước.
- **Kiểm thử 2 theme:** lặp lại nhanh ở theme tối & sáng.

## Phương án triển khai (tóm tắt)

1. Thêm nhóm `--mp-*` design tokens.
2. Viết lại CSS các block `.mp-wrap`, `.mp-mini-bar`, `.mp-body`, `.mp-tabs`, `.mp-art-row`, `.mp-eq`, `.mp-prog-*`, `.mp-ctrls`, `.mp-vol`, `.mp-autoplay`, `.mp-list*` theo thiết kế trên — **giữ class/id**, ưu tiên `str_replace` từng block.
3. Bổ sung `:focus-visible` + `aria-label` còn thiếu trong markup (không đổi id).
4. Kiểm thử thủ công trên local server (`http://localhost:5500`) ở desktop + mobile width; xác minh P1–P5.
5. (Tùy chọn) thêm slot ảnh bìa thật cho `#mpDisc`.

## Rủi ro & giảm thiểu
- **Đụng selector kéo thả JS** → kiểm tra `POINTER_IGNORE_SELECTORS` trước khi đổi class.
- **Animation nặng gây giật** → ưu tiên `transform`/`opacity`, giảm `box-shadow` động.
- **CSS theme sáng (`body:not(.theme-dark)`)** → kiểm tra player ở cả 2 theme.
