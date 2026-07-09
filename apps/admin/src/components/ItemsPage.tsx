import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pullRemote, saveItems, uuid } from "@/lib/sync";
import { type Item, type Unit } from "@/lib/training";
import {
  type Category,
  pullCategories,
  UNCATEGORIZED,
  UNCATEGORIZED_COLOR,
} from "@/lib/categories";

type Draft = {
  id: string | null;
  name: string;
  unit: Unit;
  categoryId: string | null;
};

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 編集モーダル（id=null は新規追加）
  const [draft, setDraft] = useState<Draft | null>(null);

  async function loadData() {
    if (!supabase) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setLoadError(null);
    try {
      const [remote, categories] = await Promise.all([
        pullRemote(),
        pullCategories(),
      ]);
      if (remote) setItems(remote.items);
      setCats(categories);
      setLoaded(true);
    } catch (e) {
      console.warn("[load] failed:", e);
      setLoadError("読み込みに失敗しました。通信状況を確認してください。");
    }
  }
  useEffect(() => {
    loadData();
  }, []);

  // categoryId から表示用の色・名前を解決する。
  function resolveCat(categoryId: string | null): {
    color: string;
    categoryName: string;
  } {
    const c = categoryId ? cats.find((x) => x.id === categoryId) : undefined;
    return {
      color: c?.color ?? UNCATEGORIZED_COLOR,
      categoryName: c?.name ?? UNCATEGORIZED,
    };
  }

  // 一覧を正として即時保存。失敗時は false を返し、呼び出し側で巻き戻す。
  async function persist(next: Item[]): Promise<boolean> {
    const prev = items;
    setItems(next);
    setBusy(true);
    setError(null);
    try {
      if (supabase) await saveItems(next);
      return true;
    } catch (e) {
      console.warn("[items] save failed:", e);
      setError("保存に失敗しました。通信状況を確認してもう一度お試しください。");
      setItems(prev); // 巻き戻し
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const i = items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    await persist(next);
  }

  async function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError("項目名を入力してください。");
      return;
    }
    const { color, categoryName } = resolveCat(draft.categoryId);
    let next: Item[];
    if (draft.id) {
      next = items.map((x) =>
        x.id === draft.id
          ? {
              ...x,
              name,
              unit: draft.unit,
              categoryId: draft.categoryId,
              color,
              categoryName,
            }
          : x,
      );
    } else {
      next = [
        ...items,
        {
          id: uuid(),
          name,
          unit: draft.unit,
          categoryId: draft.categoryId,
          color,
          categoryName,
        },
      ];
    }
    const ok = await persist(next);
    if (ok) setDraft(null);
  }

  async function deleteDraft() {
    if (!draft?.id) return;
    const it = items.find((x) => x.id === draft.id);
    if (it && !confirm(`「${it.name}」を削除しますか？記録も削除されます。`)) return;
    const ok = await persist(items.filter((x) => x.id !== draft.id));
    if (ok) setDraft(null);
  }

  if (!loaded) {
    return loadError ? (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[15px] text-foreground">{loadError}</p>
        <button
          onClick={loadData}
          className="rounded-xl bg-accent px-5 py-2.5 text-[16px] font-semibold text-white active:opacity-90"
        >
          再読み込み
        </button>
      </div>
    ) : (
      <div className="py-24 text-center text-[15px] text-muted">読み込み中…</div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5 flex items-center gap-2">
        <a
          href="/settings"
          className="rounded-lg px-2 py-1 text-[15px] text-accent hover:bg-slate-100"
        >
          ‹ 設定
        </a>
        <h2 className="text-[20px] font-semibold text-foreground">
          トレーニング項目
        </h2>
      </div>

      {error && (
        <p className="mb-3 text-[14px] font-medium text-red-600">{error}</p>
      )}

      {/* カード一覧（クリックで編集） */}
      <div className="space-y-2">
        {items.map((it, idx) => (
          <button
            key={it.id}
            onClick={() =>
              setDraft({
                id: it.id,
                name: it.name,
                unit: it.unit,
                categoryId: it.categoryId,
              })
            }
            className="flex w-full items-center gap-3 rounded-xl border border-card-border bg-card-bg p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm"
          >
            <span
              className="h-4 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: it.color }}
            />
            <span className="flex-1 text-[15px] font-semibold text-foreground">
              {it.name}
              <span className="ml-2 align-middle text-[12px] font-normal text-muted">
                {it.categoryName}
              </span>
            </span>
            {/* 並べ替え（カードのクリックとは独立） */}
            <span className="flex flex-col">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!busy) move(it.id, -1);
                }}
                aria-disabled={idx === 0}
                className={`px-1 text-[14px] leading-tight ${
                  idx === 0 ? "text-slate-300" : "text-slate-600 hover:text-accent"
                }`}
                aria-label="上へ"
              >
                ▲
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!busy) move(it.id, 1);
                }}
                aria-disabled={idx === items.length - 1}
                className={`px-1 text-[14px] leading-tight ${
                  idx === items.length - 1
                    ? "text-slate-300"
                    : "text-slate-600 hover:text-accent"
                }`}
                aria-label="下へ"
              >
                ▼
              </span>
            </span>
            <svg
              className="h-5 w-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        ))}
        {items.length === 0 && (
          <p className="rounded-xl border border-card-border bg-card-bg px-4 py-6 text-center text-[15px] text-muted">
            項目がありません。下のボタンから追加してください。
          </p>
        )}
      </div>

      <button
        onClick={() =>
          setDraft({
            id: null,
            name: "",
            unit: "time",
            categoryId: cats[0]?.id ?? null,
          })
        }
        className="mt-4 w-full rounded-xl border border-dashed border-slate-300 bg-card-bg px-4 py-3 text-[15px] font-semibold text-accent hover:bg-slate-50"
      >
        ＋ 項目を追加
      </button>

      {/* 編集モーダル */}
      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
          onClick={() => setDraft(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card-bg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold text-foreground">
              {draft.id ? "項目を編集" : "項目を追加"}
            </h3>

            <label className="mt-4 block text-[14px] font-medium text-slate-800">
              項目名
            </label>
            <input
              value={draft.name}
              autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="例：水泳"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-card-bg px-3 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-400"
            />

            <div className="mt-3 flex items-center justify-between">
              <p className="text-[14px] font-medium text-slate-800">カテゴリ</p>
              <a
                href="/settings/categories"
                className="text-[13px] font-medium text-accent"
              >
                カテゴリを編集 →
              </a>
            </div>
            {cats.length === 0 ? (
              <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[14px] text-muted">
                カテゴリがありません。先に「カテゴリを編集」から作成してください。
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {cats.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setDraft({ ...draft, categoryId: c.id })}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[15px] font-medium ${
                      draft.categoryId === c.id
                        ? "border-accent bg-accent-light text-accent"
                        : "border-slate-300 text-slate-700"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="mt-4 text-[14px] font-medium text-red-600">{error}</p>
            )}

            <button
              onClick={saveDraft}
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
            <div className="mt-2 flex gap-2">
              {draft.id && (
                <button
                  onClick={deleteDraft}
                  disabled={busy}
                  className="flex-1 rounded-xl border border-red-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  削除
                </button>
              )}
              <button
                onClick={() => setDraft(null)}
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-slate-800 disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
