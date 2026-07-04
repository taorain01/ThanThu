-- Lưu tên gốc của kênh anchor (BANG CHIẾN) để trả lại khi relay tắt/hết người.
-- Cột này tùy chọn: nếu chưa chạy, bot vẫn hoạt động và fallback về tên "BANG CHIẾN".
alter table public.voice_relay_config
  add column if not exists anchor_original_name text;
