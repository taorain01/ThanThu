-- Keep "Luon tham gia" only for weekend BC sessions.
-- Run in Supabase SQL Editor if bc_regulars ever accepted weekday rows.

DELETE FROM bc_regulars
WHERE day NOT IN ('sat', 'sun');

ALTER TABLE bc_regulars DROP CONSTRAINT IF EXISTS bc_regulars_day_check;

ALTER TABLE bc_regulars ADD CONSTRAINT bc_regulars_day_check
    CHECK (day IN ('sat', 'sun'));
