---
description: Áp dụng thao tác chọn nhiều item trong danh sách (Giữ lâu + Quét chọn + Cuộn tự động khi kéo ra biên)
---

# Multi Select List

Khi tạo danh sách (list) cho phép chọn nhiều item, áp dụng **4 kỹ thuật** sau:

## 4 kỹ thuật bắt buộc

| # | Tên | Mô tả |
|---|-----|-------|
| 1 | **Long Press Select** | Giữ chuột im **800ms** → bật chế độ chọn (có feedback visual: scale 0.97) |
| 2 | **Sweep Select** | Sau long press, kéo chuột qua nhiều item → chọn hàng loạt (range selection) |
| 3 | **Edge Auto-Scroll** | Khi sweep select, chuột vượt biên trên/dưới → tự cuộn. Càng xa biên → càng nhanh: `speed = 2 + distance × 0.15` |
| 4 | **Click-outside Deselect** | Click ra ngoài vùng list → huỷ chọn tất cả. Escape cũng huỷ chọn |

## Quy tắc tương tác

| Thao tác | Kết quả |
|----------|---------|
| **Click thường** | Chọn 1 item + hiện chi tiết (**QUAN TRỌNG: không được chặn bởi long press**) |
| **Kéo ngắn** (< 800ms) | Scroll danh sách (nếu có kinetic-scrolling) |
| **Giữ 800ms** → kéo | Bật sweep select — chọn nhiều item |
| **Ctrl + Click** | Toggle chọn/bỏ chọn 1 item |
| **Shift + Click** | Chọn range từ item cuối đến item hiện tại |
| **Click ra ngoài** | Huỷ chọn tất cả |
| **Escape** | Huỷ chọn tất cả |

## Tương tác với Kinetic Scrolling

- Khi long press bật sweep select → **tắt kinetic scroll** (`window._sweepSelectActive = true`)
- Khi mouseup → **bật lại** kinetic scroll (`window._sweepSelectActive = false`)
- Kinetic scroll phải kiểm tra `window._sweepSelectActive` trong mousemove handler

## Edge Auto-Scroll — tham số

```javascript
// Tốc độ tỷ lệ khoảng cách vượt biên
if (mouseY < listRect.top) {
    speed = -(2 + (listRect.top - mouseY) * 0.15);
} else if (mouseY > listRect.bottom) {
    speed = 2 + (mouseY - listRect.bottom) * 0.15;
}
```

## Xoá item đã chọn

- Xoá file đã chọn / xoá tất cả **phải có dialog xác nhận** (confirm modal)
- Exception list click-outside: thêm `.toolbar, .player, .context-menu, .modal-overlay` để không deselect khi bấm nút chức năng

## File tham chiếu

Xem implementation mẫu: `NhacRack/web/js/queue.js`
