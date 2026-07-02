-- ============================================================
-- トレーニング記録モデルの変更
--   変更前: training_records(item_id, date, value) … 項目×日ごとに数値（分/回）
--   変更後:
--     - training_items … 実施/未実施のみ（unit は未使用に）
--     - training_records … 「実施マーク」。行が存在＝その日その項目を実施
--     - daily_minutes … その日の合計トレーニング時間（分）を日ごとに1件
--
-- 既存データ移行:
--   ① 「時間」単位項目の値を日ごとに合算 → daily_minutes
--   ② training_records は実施マークとして継続（value>0=実施。0の行は削除）
-- ============================================================

-- 日単位の合計トレーニング時間
create table if not exists public.daily_minutes (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  minutes    integer not null check (minutes >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.daily_minutes enable row level security;

-- 本人は自分の分を全操作、開発者は全件（training_records と同じ方針）
drop policy if exists "daily_minutes 本人" on public.daily_minutes;
create policy "daily_minutes 本人" on public.daily_minutes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "daily_minutes 開発者は全件" on public.daily_minutes;
create policy "daily_minutes 開発者は全件" on public.daily_minutes
  for all using (public.is_developer()) with check (public.is_developer());

-- ① 既存の「時間」単位項目の値を日ごとに合算 → daily_minutes へ
insert into public.daily_minutes (user_id, date, minutes)
select r.user_id, r.date, sum(r.value)::int
from public.training_records r
join public.training_items i on i.id = r.item_id
where i.unit = 'time' and r.value > 0
group by r.user_id, r.date
on conflict (user_id, date) do nothing;

-- ② training_records は「実施マーク」として継続（value=0 の行があれば削除）
delete from public.training_records where value = 0;
