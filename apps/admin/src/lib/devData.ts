import { supabase } from "./supabase";
import type { Item, Minutes } from "./training";
import { UNCATEGORIZED, UNCATEGORIZED_COLOR } from "./categories";

// 開発者/管理者専用: 全ユーザーのトレーニングデータをユーザー単位でまとめて取得する。
// RLS により developer は training_items / training_records を全件、
// profiles も is_admin(=admin/developer) で全件参照できる。
// 一般ユーザーが呼んでも RLS で自分の分だけになる（ホーム側でロール判定して使う）。

export type UserGrid = {
  id: string;
  email: string | null;
  nickname: string | null;
  avatarPath: string | null;
  role: string;
  weekStart: number;
  items: Item[];
  categories: { id: string; name: string; color: string }[]; // sort_order 順
  minutes: Minutes; // itemId:date -> 1（実施マーク・このユーザー分）
  dayMinutes: Record<string, number>; // date -> 合計時間(分)
  recordCount: number;
};

export async function pullAllUserGrids(): Promise<UserGrid[]> {
  if (!supabase) return [];

  const [
    { data: profs, error: ep },
    { data: items, error: ei },
    { data: recs, error: er },
    { data: dms, error: ed },
    { data: cats, error: ecc },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,nickname,avatar_path,role,week_start"),
    supabase
      .from("training_items")
      .select("id,user_id,name,color,unit,sort_order,category_id")
      .order("sort_order", { ascending: true }),
    supabase.from("training_records").select("user_id,item_id,date,value"),
    supabase.from("daily_minutes").select("user_id,date,minutes"),
    supabase
      .from("categories")
      .select("id,user_id,name,color,sort_order")
      .order("sort_order", { ascending: true }),
  ]);
  if (ep) throw ep;
  if (ei) throw ei;
  if (er) throw er;
  if (ed) throw ed;
  if (ecc) throw ecc;

  const catById = new Map<string, { name: string; color: string }>();
  const categoriesByUser = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const c of cats ?? []) {
    catById.set(c.id, { name: c.name, color: c.color });
    const list = categoriesByUser.get(c.user_id) ?? [];
    list.push({ id: c.id, name: c.name, color: c.color }); // sort_order 順で取得済み
    categoriesByUser.set(c.user_id, list);
  }

  const itemsByUser = new Map<string, Item[]>();
  for (const it of items ?? []) {
    const list = itemsByUser.get(it.user_id) ?? [];
    const cat = it.category_id ? catById.get(it.category_id) : undefined;
    list.push({
      id: it.id,
      name: it.name,
      color: cat?.color ?? it.color ?? UNCATEGORIZED_COLOR,
      unit: it.unit,
      categoryId: it.category_id ?? null,
      categoryName: cat?.name ?? UNCATEGORIZED,
    });
    itemsByUser.set(it.user_id, list);
  }

  const minutesByUser = new Map<string, Minutes>();
  const recCountByUser = new Map<string, number>();
  for (const r of recs ?? []) {
    const m = minutesByUser.get(r.user_id) ?? {};
    m[`${r.item_id}:${r.date}`] = r.value;
    minutesByUser.set(r.user_id, m);
    recCountByUser.set(r.user_id, (recCountByUser.get(r.user_id) ?? 0) + 1);
  }

  const dayMinutesByUser = new Map<string, Record<string, number>>();
  for (const r of dms ?? []) {
    const m = dayMinutesByUser.get(r.user_id) ?? {};
    m[r.date] = r.minutes;
    dayMinutesByUser.set(r.user_id, m);
  }

  const users: UserGrid[] = (profs ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    nickname: p.nickname,
    avatarPath: p.avatar_path,
    role: p.role,
    weekStart: p.week_start ?? 1,
    items: itemsByUser.get(p.id) ?? [],
    categories: categoriesByUser.get(p.id) ?? [],
    minutes: minutesByUser.get(p.id) ?? {},
    dayMinutes: dayMinutesByUser.get(p.id) ?? {},
    recordCount: recCountByUser.get(p.id) ?? 0,
  }));

  // 記録が多い順 → 名前順（活発なユーザーを上に）
  users.sort((a, b) => {
    if (b.recordCount !== a.recordCount) return b.recordCount - a.recordCount;
    return (a.nickname || a.email || "").localeCompare(
      b.nickname || b.email || "",
    );
  });
  return users;
}
