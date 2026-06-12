# Requirements Document

## Introduction

Music Player hiện tại là một widget nổi (floating), luôn hiển thị ở góc màn hình, dùng phong cách glassmorphism + nhấn vàng kim (gold). Nó hỗ trợ 2 trạng thái chính: **thu gọn (mini bar)** và **mở rộng (full player)**, có thể kéo thả tự do và dock ở mobile.

Mục tiêu của spec này là **redesign lại phần giao diện (visual + bố cục + trạng thái)** của music player cho hiện đại, gọn gàng và "đắt" hơn, đồng thời **giữ nguyên toàn bộ chức năng đang chạy** (phát/dừng, chuyển bài, shuffle, repeat, volume, autoplay, đổi playlist, danh sách bài, kéo thả, đóng player).

Phạm vi: chỉ tác động đến music player (`#mpWrap` và các thành phần con `mp-*`). Không đổi logic phát nhạc cốt lõi, không đổi nguồn dữ liệu playlist.

**Thành phần hiện có (để tham chiếu):**
- **Mini bar:** nút thu/mở (mũi tên), tên bài đang phát, nút bật/tắt autoplay (mini), nút play/pause (mini), nút mở full, nút đóng (X).
- **Full body:** tab playlist (Lang Gia OST / EDM Drop), đĩa nhạc (disc) + thông tin bài (tên, playlist, "Bài x / y"), thanh EQ visualizer, thanh tiến trình + thời gian (hiện tại / tổng), cụm điều khiển (shuffle, prev, play/pause, next, repeat), thanh âm lượng, công tắc autoplay, nút mở danh sách bài.
- **Trạng thái:** collapsed, expanded, closed, dragging, playing; dock ở mobile.

**Ngoài phạm vi (Out of scope):**
- Thay đổi logic giải mã/streaming nhạc, nguồn file, hay danh sách bài.
- Thêm playlist mới hoặc tính năng mới (lyrics, equalizer chỉnh tay, v.v.) — trừ khi được bổ sung ở vòng sau.
- Redesign các phần UI khác ngoài music player.

## Glossary

- **Mini bar:** Dải điều khiển nhỏ luôn hiển thị, kể cả khi player thu gọn (`.mp-mini-bar`).
- **Full player / Full body:** Phần thân mở rộng chứa đầy đủ điều khiển (`.mp-body`).
- **Collapsed:** Trạng thái thu gọn của widget (`.mp-wrap.collapsed`).
- **Dock (mobile):** Trạng thái neo player gọn ở mobile (`.mp-mobile-docked`).
- **EQ visualizer:** Dải cột mô phỏng phổ âm thanh (`.mp-eq`).
- **Glassmorphism:** Phong cách nền mờ trong + blur + viền sáng mảnh.

## Requirements

### Requirement 1: Giữ nguyên toàn bộ chức năng sau khi redesign

**User Story:** Là người dùng đang nghe nhạc, tôi muốn sau khi giao diện được làm mới thì mọi nút/chức năng vẫn hoạt động y như cũ, để tôi không phải học lại cách dùng.

#### Acceptance Criteria
1. KHI redesign hoàn tất, HỆ THỐNG PHẢI giữ đủ các chức năng: play/pause, prev, next, shuffle, repeat, volume, autoplay, đổi playlist (tab), mở/đóng danh sách bài, thu gọn/mở rộng, đóng player, kéo thả.
2. HỆ THỐNG PHẢI giữ nguyên các `id` phần tử mà JavaScript đang gắn sự kiện (ví dụ `mpPlayBtn`, `mpVolSl`, `mpProgTrack`, `mpList`, ...) HOẶC cập nhật đồng bộ cả JS nếu đổi id.
3. KHI người dùng tương tác với mỗi control, HỆ THỐNG PHẢI thực thi đúng hành vi tương ứng như phiên bản trước redesign.

### Requirement 2: Làm mới giao diện trạng thái thu gọn (mini bar)

**User Story:** Là người dùng, tôi muốn mini bar gọn và rõ ràng hơn, để biết đang phát bài gì và điều khiển nhanh mà không chiếm nhiều diện tích.

#### Acceptance Criteria
1. KHI player ở trạng thái thu gọn, HỆ THỐNG PHẢI hiển thị tối thiểu: trạng thái phát (play/pause) và một cách để mở rộng.
2. KHI một bài đang phát, HỆ THỐNG PHẢI thể hiện trực quan trạng thái "đang phát" (ví dụ hiệu ứng nút sáng/đập nhẹ).
3. Mini bar PHẢI có kích thước và vùng chạm (touch target) đủ lớn để bấm dễ trên cả desktop lẫn mobile (tối thiểu ~32px mỗi nút bấm).

### Requirement 3: Làm mới giao diện trạng thái mở rộng (full player)

**User Story:** Là người dùng, tôi muốn full player nhìn cân đối, phân cấp thông tin rõ, để dễ đọc tên bài, tiến trình và thao tác điều khiển.

#### Acceptance Criteria
1. KHI player mở rộng, HỆ THỐNG PHẢI hiển thị rõ phân cấp: tiêu đề/đang phát → tabs playlist → thông tin bài + đĩa → tiến trình → điều khiển → âm lượng → autoplay → danh sách.
2. HỆ THỐNG PHẢI giữ thanh EQ visualizer và thanh tiến trình; cho phép tinh chỉnh visual (màu, độ dày, animation) nhưng KHÔNG bỏ chức năng tua bằng thanh tiến trình.
3. KHI nội dung dài, HỆ THỐNG PHẢI đảm bảo không tràn/vỡ layout (overflow xử lý đúng) trên màn hình nhỏ.

### Requirement 4: Hệ thống thị giác nhất quán (visual language)

**User Story:** Là người dùng, tôi muốn music player ăn nhập với tổng thể giao diện Lang Gia (tông xanh rêu + vàng kim), để cảm giác liền mạch và sang.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI dùng bảng màu/biến CSS hiện có (`--gold`, tông xanh rêu, ...) thay vì màu rời rạc mới.
2. HỆ THỐNG PHẢI duy trì phong cách glass + viền/nhấn vàng kim ở mức tinh tế (tránh quá rực/quá chói).
3. CÁC trạng thái hover/active/focus PHẢI có phản hồi thị giác nhất quán giữa các nút.

### Requirement 5: Khả năng đáp ứng & kéo thả (responsive & drag)

**User Story:** Là người dùng trên nhiều thiết bị, tôi muốn player vẫn kéo thả được trên desktop và dock gọn trên mobile sau khi redesign.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI giữ khả năng kéo thả widget trên desktop và cơ chế dock trên mobile như hiện tại.
2. KHI ở mobile, HỆ THỐNG PHẢI hiển thị player ở dạng phù hợp màn hình hẹp (không tràn ngang).
3. KHI kéo thả, HỆ THỐNG KHÔNG ĐƯỢC kích hoạt nhầm các nút điều khiển bên trong.

### Requirement 6: Khả năng tiếp cận (accessibility)

**User Story:** Là người dùng dùng bàn phím hoặc trình đọc màn hình, tôi muốn các control có nhãn và focus rõ ràng.

#### Acceptance Criteria
1. CÁC nút điều khiển PHẢI có `title`/`aria-label` mô tả đúng chức năng.
2. CÁC control đóng/mở (collapse, autoplay) PHẢI cập nhật trạng thái `aria-pressed`/`aria-expanded` phù hợp.
3. HỆ THỐNG PHẢI có chỉ báo focus nhìn thấy được khi điều hướng bằng bàn phím.

## Quyết định đã chốt

Các câu hỏi mở ban đầu đã được chốt (phản ánh trong `design.md` mục "Định hướng đã chốt"):

1. **Phong cách:** Giữ phong cách hiện tại, chỉ *tinh chỉnh & hiện đại hóa* (refine) — bo góc mềm vừa, glass tinh tế, giảm độ chói của gold, tăng phân cấp. Không lật đổ thiết kế.
2. **Mini bar:** Giữ đủ nút như hiện tại nhưng *sắp xếp lại cho gọn & cân*, nhấn mạnh nút play (trạng thái đang phát).
3. **Artwork:** Giữ đĩa vinyl giả lập làm mặc định; *chừa slot hỗ trợ ảnh bìa thật* (tùy chọn, không bắt buộc ở vòng này).

> Nếu muốn đổi bất kỳ quyết định nào, cập nhật mục này và `design.md` trước khi triển khai task tương ứng.
