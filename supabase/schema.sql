-- 小票簿資料庫設定：在 Supabase 後台 → SQL Editor → New query，貼上全部內容後按 Run。

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  merchant_zh text not null default '',
  merchant_orig text not null default '',
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'KRW',
  rate numeric(14,6) not null check (rate > 0),
  hkd numeric(14,2) not null,
  category text not null default 'other',
  pay_method text not null default '',
  report_id uuid references public.reports on delete set null,
  tags text[] not null default '{}',
  note text not null default '',
  items jsonb not null default '[]',
  photo_path text not null default '',
  status text not null default 'pending' check (status in ('pending','done')),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_by_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (date desc);
create index if not exists expenses_report_idx on public.expenses (report_id);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  rates jsonb not null default '{}',
  accounts jsonb not null default '{}'
);

-- 權限：只有已登入的公司成員可以讀寫（帳戶由管理員在後台建立）
alter table public.reports  enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;

drop policy if exists "members" on public.reports;
drop policy if exists "members" on public.expenses;
drop policy if exists "members" on public.settings;
create policy "members" on public.reports  for all to authenticated using (true) with check (true);
create policy "members" on public.expenses for all to authenticated using (true) with check (true);
create policy "members" on public.settings for all to authenticated using (true) with check (true);

-- 收據相片（私人儲存桶，只有成員可以看）
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
drop policy if exists "members read receipts" on storage.objects;
drop policy if exists "members upload receipts" on storage.objects;
drop policy if exists "members delete receipts" on storage.objects;
create policy "members read receipts"   on storage.objects for select to authenticated using (bucket_id = 'receipts');
create policy "members upload receipts" on storage.objects for insert to authenticated with check (bucket_id = 'receipts');
create policy "members delete receipts" on storage.objects for delete to authenticated using (bucket_id = 'receipts');

-- 即時更新：同事新增收據時，其他人的畫面會自動刷新
do $$ begin
  alter publication supabase_realtime add table public.expenses, public.reports, public.settings;
exception when duplicate_object then null; end $$;
