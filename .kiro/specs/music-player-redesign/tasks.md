# Implementation Plan

## Overview

Tất cả thay đổi nằm trong `WebBangChien/index.html` (CSS inline trong `<style>`, markup music player quanh `#mpWrap`). Nguyên tắc xuyên suốt: **giữ nguyên id & handler** (Property 1, 2), ưu tiên `str_replace` từng block CSS, kiểm tra ở cả theme tối/sáng. Task 1–10 là triển khai, 11–12 là xác minh & nghiệm thu.

## Tasks

- [x] 1. Thêm nhóm design tokens `--mp-*`
  - Khai báo biến (`--mp-radius`, `--mp-glass-bg`, `--mp-border`, `--mp-gold-soft`, `--mp-text`, `--mp-text-dim`, `--mp-shadow`, `--mp-focus`, ...) trong `:root` và nhánh `body:not(.theme-dark)`
  - Không đổi giao diện ở bước này, chỉ chuẩn bị biến cho các bước sau
  - _Requirements: 4.1, 4.2_

- [x] 2. Redesign khối chính `.mp-wrap` (glass + bóng + bo góc)
  - Đơn giản hóa nền glass về 1 lớp gradient + 1 viền `--mp-border`, giảm chồng lớp gradient gold gây chói
  - Áp `--mp-radius`, `--mp-shadow`; giữ `backdrop-filter`, `position:fixed`, kích thước & transition collapse/expand
  - Giữ các class trạng thái (`collapsed`, `mp-closed`, `mp-dragging`, `mp-mobile-docked`)
  - _Requirements: 3.1, 4.1, 4.2_

- [x] 3. Redesign Mini Bar
  - Sắp xếp lại layout pill: collapse arrow → tên bài → autoplay → play → (expand) → close, gap đều
  - Mỗi nút bấm ≥ 32×32px (Property 4); nút play là điểm nhấn gold, glow đập nhẹ khi `.playing` (giảm ~30%)
  - Giữ hành vi ẩn/hiện theo `collapsed` (ẩn tên/autoplay/X khi thu gọn)
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Redesign Playlist Tabs thành segmented control
  - Gộp `#mpTab0` / `#mpTab1` vào 1 nền pill, tab `.active` nền gold dịu, tab thường trong suốt
  - Giữ `onclick="mpSwitchPl(0|1)"` và id tab
  - _Requirements: 1.1, 1.3, 4.3_

- [x] 5. Redesign Art-row (disc + thông tin bài) và slot artwork tùy chọn
  - Tên bài `#mpTname` cỡ lớn/đậm, `#mpTpl` + `#mpTidx` nhỏ & dim; ellipsis chống tràn
  - Giữ đĩa `#mpDisc` + hiệu ứng quay; hỗ trợ `background-image` ảnh bìa (fallback gradient/vinyl khi lỗi/không có)
  - _Requirements: 3.1, 3.3, 4.1_

- [x] 6. Redesign EQ visualizer và Progress bar
  - EQ: gradient gold mảnh hơn, đỉnh bo nhẹ; giữ `#mpEq` để JS bơm cột
  - Progress: track mảnh + fill gradient gold + thumb tròn khi hover/seek; thời gian dùng `tabular-nums`
  - Giữ `#mpProgTrack`, `#mpProgFill`, `#mpTcur`, `#mpTtot` và chức năng tua
  - _Requirements: 1.1, 3.2_

- [x] 7. Redesign cụm Controls
  - Nút play `#mpPlayBtn` to & nổi (gold); 4 nút phụ (`#mpShuf`, prev, next, `#mpRep`) đồng cỡ
  - Trạng thái active (shuffle/repeat bật) tô gold nhất quán; hover/active đồng bộ
  - Giữ id + handler (`mpToggleShuf`, `mpPrev`, `mpTogglePlay`, `mpNext`, `mpToggleRep`)
  - _Requirements: 1.1, 1.3, 4.3_

- [x] 8. Redesign Volume, Autoplay toggle và Playlist dropdown
  - Volume slider mảnh + thumb gold (`#mpVolSl`, biến `--vp`); giữ `mpSetVol`
  - Autoplay toggle (`#mpAutoplay`, `.mp-mini-autoplay`) thống nhất style; giữ `mpSetAutoplay`/`mpToggleAutoplayMini`
  - Nút danh sách + popover `#mpList` giữ cơ chế định vị; giữ `mpToggleList`, `#mpListCnt`
  - _Requirements: 1.1, 1.3, 3.1_

- [x] 9. Accessibility: focus-visible + aria
  - Thêm `:focus-visible` ring (`--mp-focus`) cho mọi control
  - Bổ sung `aria-label` cho nút icon-only còn thiếu; đồng bộ `aria-expanded` (`#mpCollapseBtn`) và `aria-pressed`/`checked` (autoplay)
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 10. Hoàn thiện theme sáng & responsive/mobile
  - Bổ sung nhánh `body:not(.theme-dark)` cho mọi màu mới; kiểm tra tương phản
  - Rà soát media query `.mp-mobile-docked` & giới hạn `width`/`max-height` để không tràn ngang ở màn hẹp
  - _Requirements: 4.1, 5.1, 5.2_

- [x] 11. Xác minh bảo toàn id & handler (Property 1, 2)
  - Rà soát toàn bộ id trong "Hợp đồng với JavaScript" (design.md) tồn tại đúng 1 lần
  - Rà soát `onclick/oninput` inline vẫn trỏ đúng tên hàm; kiểm tra `POINTER_IGNORE_SELECTORS` còn khớp class kéo thả
  - _Requirements: 1.1, 1.2, 1.3, 5.3_

- [ ] 12. Kiểm thử thủ công & nghiệm thu
  - Chạy local server, kiểm tra breakpoint (≥1280px, ~768px, 320px) cho mọi trạng thái — không tràn ngang/chồng chữ (Property 3, 5)
  - Bấm thử toàn bộ chức năng (play/pause, prev/next, shuffle, repeat, volume, autoplay, đổi tab, danh sách, kéo thả, đóng) đối chiếu hành vi cũ
  - Đo touch target mini bar ≥ 32px (Property 4); lặp lại ở theme tối & sáng
  - _Requirements: 1.1, 2.3, 3.3, 5.2_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4", "5", "6", "7", "8"] },
    { "wave": 4, "tasks": ["9"] },
    { "wave": 5, "tasks": ["10"] },
    { "wave": 6, "tasks": ["11"] },
    { "wave": 7, "tasks": ["12"] }
  ]
}
```

```
1 (tokens)
└─> 2 (.mp-wrap)
     ├─> 3 (mini bar)
     └─> 4,5,6,7,8 (các phần trong full body — có thể làm song song)
3,4,5,6,7,8 ──> 9 (accessibility)
9 ──> 10 (theme sáng + responsive)
10 ──> 11 (xác minh id/handler)
11 ──> 12 (kiểm thử & nghiệm thu)
```

- Task 1 là nền tảng, làm trước.
- Task 2 mở đường cho 3–8.
- Task 4,5,6,7,8 độc lập nhau, có thể làm theo thứ tự bất kỳ.
- Task 9–12 tuần tự ở cuối.

## Notes

- Không tạo file mới; mọi thay đổi trong `WebBangChien/index.html`.
- Ưu tiên `str_replace` từng block CSS nhỏ; tránh thay cả vùng lớn để giảm rủi ro.
- Không đổi logic phát nhạc/JS trừ khi bắt buộc đồng bộ id (khi đó sửa đúng chỗ bind).
- Kiểm thử ở local server `http://localhost:5500` (đang chạy).
- Có file backup `index.html.bak_*` để đối chiếu nếu cần.
