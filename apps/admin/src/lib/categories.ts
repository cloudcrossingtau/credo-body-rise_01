import { supabase } from "./supabase";
import { withTimeout } from "./recover";

// カテゴリ（名前＋色）。トレーニング項目の分類に使う。ユーザーごと所有。
// 項目の表示色はカテゴリの色を継承する（1項目=1カテゴリ）。

export type Category = { id: string; name: string; color: string };

export const UNCATEGORIZED = "未分類";
export const UNCATEGORIZED_COLOR = "#94a3b8"; // 未分類の表示色（slate-400）

const to = <T>(p: PromiseLike<T>): Promise<T> =>
  withTimeout(() => Promise.resolve(p), 8000, "categories");

// crypto.randomUUID フォールバック（sync.ts と同等）
export function categoryUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 本人のカテゴリ一覧。
export async function pullCategories(): Promise<Category[]> {
  if (!supabase) return [];
  const { data: s } = await to(supabase.auth.getSession());
  const uid = s.session?.user?.id;
  if (!uid) return [];
  const { data, error } = await to(
    supabase
      .from("categories")
      .select("id,name,color,sort_order")
      .eq("user_id", uid)
      .order("sort_order", { ascending: true }),
  );
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

// 現在の一覧を正として upsert＋一覧に無いものを削除（saveItems と同方針）。
// カテゴリ削除時、そのカテゴリを参照する項目は category_id が NULL（未分類）になる。
export async function saveCategories(cats: Category[]): Promise<void> {
  if (!supabase) throw new Error("Supabase 未設定");
  const { data: s } = await to(supabase.auth.getSession());
  const uid = s.session?.user?.id;
  if (!uid) throw new Error("未ログイン");

  const { data: remote, error: e1 } = await to(
    supabase.from("categories").select("id").eq("user_id", uid),
  );
  if (e1) throw e1;
  const localIds = new Set(cats.map((c) => c.id));
  const delIds = (remote ?? [])
    .map((r) => r.id)
    .filter((id) => !localIds.has(id));
  if (delIds.length) {
    const { error } = await to(
      supabase.from("categories").delete().in("id", delIds),
    );
    if (error) throw error;
  }
  if (cats.length) {
    const rows = cats.map((c, i) => ({
      id: c.id,
      user_id: uid,
      name: c.name,
      color: c.color,
      sort_order: i,
    }));
    const { error } = await to(supabase.from("categories").upsert(rows));
    if (error) throw error;
  }
}
