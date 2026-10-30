-- ============================================================
-- ComplianceScan Supabase 数据库结构
-- 在 Supabase Dashboard → SQL Editor 中执行本文件
-- ============================================================

-- 1) 扫描历史（前端按 user_id 行级隔离）
create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  url         text not null,
  score       int  not null,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists scans_user_created_idx
  on public.scans (user_id, created_at desc);

alter table public.scans enable row level security;

drop policy if exists "scans_select_own" on public.scans;
create policy "scans_select_own" on public.scans
  for select using (auth.uid() = user_id);

drop policy if exists "scans_insert_own" on public.scans;
create policy "scans_insert_own" on public.scans
  for insert with check (auth.uid() = user_id);

-- 2) 订阅状态（由 Creem Webhook 经 service role 写入，前端不直接访问）
create table if not exists public.subscriptions (
  email       text primary key,
  status      text not null,
  plan        text,
  updated_at  timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
-- 订阅表仅供服务端（service role）读写，不向前端开放策略

-- 3) 监控项（前端按 user_id 行级隔离，服务端 service role 批量读取）
create table if not exists public.monitors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  email         text not null,
  url           text not null,
  active        boolean not null default true,
  last_score    int,
  last_checks   jsonb,
  last_scan_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists monitors_active_idx on public.monitors (active, id);

alter table public.monitors enable row level security;

drop policy if exists "monitors_select_own" on public.monitors;
create policy "monitors_select_own" on public.monitors
  for select using (auth.uid() = user_id);

drop policy if exists "monitors_insert_own" on public.monitors;
create policy "monitors_insert_own" on public.monitors
  for insert with check (auth.uid() = user_id);

drop policy if exists "monitors_delete_own" on public.monitors;
create policy "monitors_delete_own" on public.monitors
  for delete using (auth.uid() = user_id);

-- 若表已存在，追加趋势历史字段（幂等）
alter table public.monitors add column if not exists score_history jsonb not null default '[]'::jsonb;
