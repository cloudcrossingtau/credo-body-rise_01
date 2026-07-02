import { supabase } from "./supabase";
import { withTimeout } from "./recover";

// Supabase が唯一の正（source of truth）。普通のWebアプリと同じく、
// 各操作はその場で Supabase に書き込み、成功/失敗を呼び出し側で扱う。
// localStorage は記録の保存には使わない（マルチ端末対応・二重管理の排除）。

// Supabase 呼び出しにタイムアウトを付ける（スリープ復帰後などに無言で固まる事象対策）。
// 固まったら例外で返るので、呼び出し側で「失敗」として扱える（保存中のまま固定を防ぐ）。
const to = <T>(p: PromiseLike<T>): Promise<T> =>
  withTimeout(() => Promise.resolve(p), 8000, "sync");

export type Unit = "time" | "count";
export type SyncItem = { id: string; name: string; color: string; unit: Unit };
export type RemoteState = {
  items: SyncItem[];
  // 項目の実施マーク。key=`${itemId}:${date}` -> 1（実施）。行が無ければ未実施。
  minutes: Record<string, number>;
  // その日の合計トレーニング時間（分）。key=`${date}` -> 分。
  dayMinutes: Record<string, number>;
  weekStart: number | null;
};

// crypto.randomUUID は secure context 限定なのでフォールバック付き
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function requireUserId(): Promise<string> {
  if (!supabase) throw new Error("Supabase 未設定");
  // getSession はローカル(localStorage)から即取得（通信なし）。getUser はサーバー検証で
  // 往復が発生するため、保存のたびに遅くなる。本人判定はRLSがサーバー側で強制するので、
  // user_id はローカルの値で十分・安全。
  const { data } = await to(supabase.auth.getSession());
  const uid = data.session?.user?.id;
  if (!uid) throw new Error("未ログイン");
  return uid;
}

// ---- 読み込み（起動時） ----
// リモートの全データを取得。未ログイン/未設定なら null。
export async function pullRemote(): Promise<RemoteState | null> {
  if (!supabase) return null;
  const { data: s } = await to(supabase.auth.getSession());
  const uid = s.session?.user?.id;
  if (!uid) return null;

  const { data: itemRows, error: e1 } = await to(
    supabase
      .from("training_items")
      .select("id,name,color,unit,sort_order")
      .eq("user_id", uid) // 本人のデータのみ（開発者でも個人タブは本人分だけに限定）
      .order("sort_order", { ascending: true }),
  );
  if (e1) throw e1;
  const items: SyncItem[] = (itemRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    unit: r.unit,
  }));

  const { data: recRows, error: e2 } = await to(
    supabase
      .from("training_records")
      .select("item_id,date,value")
      .eq("user_id", uid), // 本人のデータのみ
  );
  if (e2) throw e2;
  const minutes: Record<string, number> = {};
  for (const r of recRows ?? []) minutes[`${r.item_id}:${r.date}`] = r.value;

  const { data: dmRows, error: e3 } = await to(
    supabase.from("daily_minutes").select("date,minutes").eq("user_id", uid),
  );
  if (e3) throw e3;
  const dayMinutes: Record<string, number> = {};
  for (const r of dmRows ?? []) dayMinutes[r.date] = r.minutes;

  const { data: prof } = await to(
    supabase.from("profiles").select("week_start").eq("id", uid).single(),
  );

  return { items, minutes, dayMinutes, weekStart: prof?.week_start ?? null };
}

// ---- その日の合計トレーニング時間（分）----
// minutes>0 で保存（上書き）、0/未入力なら削除。
export async function saveDayMinutes(
  date: string,
  minutes: number,
): Promise<void> {
  const uid = await requireUserId();
  if (minutes > 0) {
    const { error } = await to(
      supabase!
        .from("daily_minutes")
        .upsert(
          { user_id: uid, date, minutes },
          { onConflict: "user_id,date" },
        ),
    );
    if (error) throw error;
  } else {
    const { error } = await to(
      supabase!
        .from("daily_minutes")
        .delete()
        .eq("user_id", uid)
        .eq("date", date),
    );
    if (error) throw error;
  }
}

// ---- 記録（1件ずつ即時保存） ----
// 値>0 を1件保存（同じ item_id+date があれば上書き）。
export async function saveRecord(
  itemId: string,
  date: string,
  value: number,
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await to(
    supabase!
      .from("training_records")
      .upsert(
        { user_id: uid, item_id: itemId, date, value },
        { onConflict: "user_id,item_id,date" },
      ),
  );
  if (error) throw error;
}

// 記録を1件削除（値0＝未入力）。
export async function deleteRecord(
  itemId: string,
  date: string,
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await to(
    supabase!
      .from("training_records")
      .delete()
      .eq("user_id", uid)
      .eq("item_id", itemId)
      .eq("date", date),
  );
  if (error) throw error;
}

// ---- 項目（設定の「保存」でまとめて反映） ----
// 現在の項目一覧を正として、upsert＋一覧に無い項目をdelete（子の記録はCASCADE削除）。
export async function saveItems(items: SyncItem[]): Promise<void> {
  const uid = await requireUserId();

  const { data: remoteItems, error: e1 } = await to(
    supabase!.from("training_items").select("id").eq("user_id", uid), // 本人の項目のみ対象
  );
  if (e1) throw e1;
  const localIds = new Set(items.map((i) => i.id));
  const delIds = (remoteItems ?? [])
    .map((r) => r.id)
    .filter((id) => !localIds.has(id));
  if (delIds.length) {
    const { error } = await to(
      supabase!.from("training_items").delete().in("id", delIds),
    );
    if (error) throw error;
  }
  if (items.length) {
    const rows = items.map((it, i) => ({
      id: it.id,
      user_id: uid,
      name: it.name,
      color: it.color,
      unit: it.unit,
      sort_order: i,
    }));
    const { error } = await to(supabase!.from("training_items").upsert(rows));
    if (error) throw error;
  }
}

// ---- 週開始曜日 ----
export async function saveWeekStart(weekStart: number): Promise<void> {
  const uid = await requireUserId();
  const { error } = await to(
    supabase!.from("profiles").update({ week_start: weekStart }).eq("id", uid),
  );
  if (error) throw error;
}
