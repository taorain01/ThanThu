-- ============================================
-- Migration: Mở rộng cột 'day' cho phép tất cả ngày trong tuần
-- ============================================

-- 1. Xóa constraint cũ (chỉ cho phép sat/sun)
ALTER TABLE bc_sessions DROP CONSTRAINT IF EXISTS bc_sessions_day_check;

-- 2. Thêm constraint mới (cho phép tất cả ngày)
ALTER TABLE bc_sessions ADD CONSTRAINT bc_sessions_day_check 
    CHECK (day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'));

-- 3. Thêm cột time và note nếu chưa có
ALTER TABLE bc_sessions ADD COLUMN IF NOT EXISTS time TEXT DEFAULT '19:30';
ALTER TABLE bc_sessions ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';

-- ✅ Kiểm tra
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bc_sessions';
