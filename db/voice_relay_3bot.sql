-- ============================================================================
-- Voice Relay 3 bot + quick setup migration
-- Chạy trong Supabase SQL Editor. An toàn chạy lại nhiều lần.
-- ============================================================================

alter table public.voice_relay_config
  add column if not exists caller_user_ids jsonb not null default '[]'::jsonb;

alter table public.voice_relay_config
  add column if not exists muted_user_ids jsonb not null default '[]'::jsonb;

-- Độ trễ chống giật (jitter buffer) khi phát audio relay, đơn vị ms. Mặc định 400.
alter table public.voice_relay_config
  add column if not exists jitter_buffer_ms int not null default 400;

alter table public.voice_relay_status
  add column if not exists channel_member_count int not null default 0;

alter table public.voice_relay_status
  add column if not exists bot_username text;

alter table public.voice_relay_status
  add column if not exists bot_avatar_url text;

create table if not exists public.voice_relay_master (
  guild_id   text        not null primary key,
  enabled    boolean     not null default false,
  stop_mode  text,
  updated_at timestamptz not null default now()
);

create table if not exists public.voice_relay_managed_channels (
  guild_id     text        not null,
  channel_id   text        not null,
  owner_bot_id int         not null,
  created_at   timestamptz not null default now(),
  primary key (guild_id, channel_id)
);

alter table public.voice_relay_master           enable row level security;
alter table public.voice_relay_managed_channels enable row level security;

drop policy if exists "voice_relay_master_read" on public.voice_relay_master;
drop policy if exists "voice_relay_managed_channels_read" on public.voice_relay_managed_channels;

create policy "voice_relay_master_read"
  on public.voice_relay_master for select
  using (true);

create policy "voice_relay_managed_channels_read"
  on public.voice_relay_managed_channels for select
  using (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.voice_relay_master;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.voice_relay_managed_channels;
  exception when duplicate_object then null;
  end;
end $$;
