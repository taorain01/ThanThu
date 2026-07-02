    -- ============================================================================
    -- Voice Relay Bots - Supabase schema
    -- Dùng chung project Supabase với web Bang Chiến.
    -- Chạy trong Supabase SQL Editor. An toàn chạy lại (IF NOT EXISTS / OR REPLACE).
    -- ============================================================================

    -- ---------------------------------------------------------------------------
    -- 1) Cấu hình runtime của mỗi bot (web ghi, bot đọc). Mỗi bot 1 dòng.
    -- ---------------------------------------------------------------------------
    create table if not exists public.voice_relay_config (
      guild_id          text        not null,
      bot_id            int         not null,
      voice_channel_id  text,
      mode              text        not null default 'bridge',   -- bridge | broadcast
      caller_role_ids   jsonb       not null default '[]'::jsonb,
      blocked_role_ids  jsonb       not null default '[]'::jsonb,
      relay_targets     jsonb       not null default '[]'::jsonb, -- [bot_id...] đích khi broadcast
      speaker_priority  text        not null default 'mix',       -- mix | priority
      priority_role_ids jsonb       not null default '[]'::jsonb,
      relay_enabled     boolean     not null default false,
      auto_join         boolean     not null default true,
      command_prefix    text,
      pending_action    text,                                     -- rejoin | leave | null
      updated_at        timestamptz not null default now(),
      primary key (guild_id, bot_id)
    );

    -- ---------------------------------------------------------------------------
    -- 2) Trạng thái sống của mỗi bot (bot ghi, web đọc). Mỗi bot 1 dòng.
    -- ---------------------------------------------------------------------------
    create table if not exists public.voice_relay_status (
      guild_id           text        not null,
      bot_id             int         not null,
      discord_connected  boolean     not null default false,
      voice_channel_id   text,
      voice_channel_name text,
      relay_enabled      boolean     not null default false,
      link_connected     boolean     not null default false,
      last_error         text,
      heartbeat_at       timestamptz not null default now(),
      primary key (guild_id, bot_id)
    );

    -- ---------------------------------------------------------------------------
    -- 3) Danh sách kênh voice + role của guild (bot ghi, web đọc để chọn dropdown).
    -- ---------------------------------------------------------------------------
    create table if not exists public.voice_relay_guild_meta (
      guild_id       text        not null primary key,
      voice_channels jsonb       not null default '[]'::jsonb,   -- [{id,name}]
      roles          jsonb       not null default '[]'::jsonb,   -- [{id,name}]
      updated_at     timestamptz not null default now()
    );

    -- ---------------------------------------------------------------------------
    -- RLS: cho phép ĐỌC bằng anon key (web hiển thị); mọi GHI đi qua service key.
    -- Service role bỏ qua RLS nên không cần policy insert/update cho ghi.
    -- ---------------------------------------------------------------------------
    alter table public.voice_relay_config     enable row level security;
    alter table public.voice_relay_status     enable row level security;
    alter table public.voice_relay_guild_meta enable row level security;

    drop policy if exists "voice_relay_config_read"     on public.voice_relay_config;
    drop policy if exists "voice_relay_status_read"     on public.voice_relay_status;
    drop policy if exists "voice_relay_guild_meta_read" on public.voice_relay_guild_meta;

    create policy "voice_relay_config_read"
      on public.voice_relay_config for select
      using (true);

    create policy "voice_relay_status_read"
      on public.voice_relay_status for select
      using (true);

    create policy "voice_relay_guild_meta_read"
      on public.voice_relay_guild_meta for select
      using (true);

    -- ---------------------------------------------------------------------------
    -- Bật Realtime để web nhận cập nhật trạng thái và bot nhận cập nhật cấu hình.
    -- (Bỏ qua lỗi nếu bảng đã nằm trong publication.)
    -- ---------------------------------------------------------------------------
    do $$
    begin
      begin
        alter publication supabase_realtime add table public.voice_relay_config;
      exception when duplicate_object then null;
      end;
      begin
        alter publication supabase_realtime add table public.voice_relay_status;
      exception when duplicate_object then null;
      end;
      begin
        alter publication supabase_realtime add table public.voice_relay_guild_meta;
      exception when duplicate_object then null;
      end;
    end $$;


-- ============================================================================
-- BỔ SUNG: cấu hình "bot tự tạo kênh voice khi bật relay"
-- Chạy block này trong Supabase SQL Editor (an toàn nếu chạy lại nhiều lần).
-- ============================================================================
alter table public.voice_relay_config add column if not exists auto_create_channel      boolean not null default false;
alter table public.voice_relay_config add column if not exists created_channel_name     text;
alter table public.voice_relay_config add column if not exists create_position          text    not null default 'below';  -- above | below (so voi kenh moc)
alter table public.voice_relay_config add column if not exists create_anchor_channel_id text;
