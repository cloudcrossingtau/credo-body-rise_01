-- ============================================================
-- カテゴリ（本採用）。トレーニング項目を「カテゴリ（名前＋色）」で分類する。
--   - categories        … カテゴリのマスタ（名前・色）。ユーザーごと所有。
--   - training_items    … category_id を持ち、色はカテゴリから継承（1項目=1カテゴリ）。
-- 既存データ移行:
--   使用中の色ごとにカテゴリを自動生成（名前は暫定の推測名）→ 同色の項目を紐付け。
-- ============================================================

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  color      text not null default '#3b82f6',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_categories_user
  on public.categories (user_id, sort_order);

alter table public.categories enable row level security;

-- 本人は自分のカテゴリを全操作
drop policy if exists "categories 本人" on public.categories;
create policy "categories 本人" on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 開発者は全件（training_items と同じ方針）
drop policy if exists "categories 開発者は全件" on public.categories;
create policy "categories 開発者は全件" on public.categories
  for all using (public.is_developer()) with check (public.is_developer());

-- 項目にカテゴリを付与（カテゴリ削除時は未分類=NULL に）
alter table public.training_items
  add column if not exists category_id uuid references public.categories (id) on delete set null;

-- ① 使用中の色ごとにカテゴリを作成（名前は暫定の推測名。設定画面で変更可）
insert into public.categories (user_id, name, color)
select distinct
  i.user_id,
  case i.color
    when '#3b82f6' then '有酸素・スタミナ'
    when '#06b6d4' then '有酸素・スタミナ'
    when '#ef4444' then '筋力'
    when '#f59e0b' then '体幹・柔軟'
    when '#10b981' then 'バランス・調整'
    when '#14b8a6' then 'バランス・調整'
    when '#8b5cf6' then '敏捷・瞬発'
    when '#ec4899' then '競技スキル'
    else 'その他'
  end,
  i.color
from public.training_items i
where i.color is not null
  and not exists (
    select 1 from public.categories c
    where c.user_id = i.user_id and c.color = i.color
  );

-- ② 各項目を同じ色のカテゴリに紐付け
update public.training_items i
set category_id = c.id
from public.categories c
where c.user_id = i.user_id
  and c.color = i.color
  and i.category_id is null;
