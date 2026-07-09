import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { withRetry, autoReloadOnce } from "@/lib/recover";
import {
  type Category,
  pullCategories,
  saveCategories,
  categoryUuid,
} from "@/lib/categories";

const COLOR_CHOICES = [
  "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6",
];

// モバイル版カテゴリ管理。名前＋色の CRUD（DBベース）。保存後に onSaved で親を更新。
export function MobileCategories({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      setLoaded(true);
      return;
    }
    try {
      setCats(
        await withRetry(() => pullCategories(), {
          timeoutMs: 5000,
          maxAttempts: 3,
          label: "pullCategories",
        }),
      );
      setLoaded(true);
    } catch (e) {
      console.warn("[categories] load failed:", e);
      if (!autoReloadOnce()) setError("読み込みに失敗しました。");
      setLoaded(true);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function addCat() {
    const used = new Set(cats.map((c) => c.color));
    const color = COLOR_CHOICES.find((c) => !used.has(c)) ?? COLOR_CHOICES[0];
    setCats((prev) => [...prev, { id: categoryUuid(), name: "", color }]);
  }
  function update(id: string, patch: Partial<Category>) {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function move(id: string, dir: -1 | 1) {
    setCats((prev) => {
      const i = prev.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function remove(id: string) {
    const c = cats.find((x) => x.id === id);
    if (
      c &&
      !confirm(
        `「${c.name || "（無名）"}」を削除しますか？\nこのカテゴリの項目は「未分類」になります（記録は残ります）。`,
      )
    )
      return;
    setCats((prev) => prev.filter((c) => c.id !== id));
  }
  async function onSave() {
    if (cats.some((c) => !c.name.trim())) {
      setError("カテゴリ名を入力してください。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const clean = cats.map((c) => ({ ...c, name: c.name.trim() }));
      if (supabase) await saveCategories(clean);
      onSaved();
      onBack();
    } catch (e) {
      console.warn("[categories] save failed:", e);
      setError("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-24">
      <header
        className="sticky top-0 z-30 -mx-4 mb-3 border-b border-card-border bg-background px-4"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="flex h-14 items-center gap-2">
          <button
            onClick={onBack}
            aria-label="戻る"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:bg-gray-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="text-[17px] font-semibold text-foreground">
            カテゴリ
          </span>
        </div>
      </header>

      {!loaded ? (
        <p className="py-16 text-center text-[15px] text-muted">読み込み中…</p>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-muted">
            トレーニング項目を分類するカテゴリ（名前＋色）です。項目の色はカテゴリの色になります。
          </p>
          <div className="space-y-2">
            {cats.map((c, idx) => (
              <div
                key={c.id}
                className="rounded-xl border border-card-border bg-card-bg p-3"
              >
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(c.id, -1)}
                      disabled={idx === 0}
                      className="px-1 text-[14px] leading-tight text-slate-600 disabled:opacity-30 dark:text-slate-300"
                      aria-label="上へ"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => move(c.id, 1)}
                      disabled={idx === cats.length - 1}
                      className="px-1 text-[14px] leading-tight text-slate-600 disabled:opacity-30 dark:text-slate-300"
                      aria-label="下へ"
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    value={c.name}
                    onChange={(e) => update(c.id, { name: e.target.value })}
                    placeholder="カテゴリ名（例：筋力）"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-card-bg px-2.5 py-2 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    onClick={() => remove(c.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-[15px] font-semibold text-white"
                    aria-label="削除"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COLOR_CHOICES.map((col) => (
                    <button
                      key={col}
                      onClick={() => update(c.id, { color: col })}
                      aria-label={col}
                      className={`h-7 w-7 rounded-full ${
                        c.color === col
                          ? "ring-2 ring-slate-500 ring-offset-2 dark:ring-offset-slate-900"
                          : ""
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {cats.length === 0 && (
              <p className="rounded-xl border border-card-border bg-card-bg px-4 py-6 text-center text-[15px] text-muted">
                カテゴリがありません。下から追加してください。
              </p>
            )}
          </div>

          <button
            onClick={addCat}
            className="mt-3 w-full rounded-xl border border-dashed border-slate-300 bg-card-bg px-4 py-3 text-[15px] font-semibold text-accent"
          >
            ＋ カテゴリを追加
          </button>

          {error && (
            <p className="mt-4 text-[14px] font-medium text-red-600">{error}</p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
            <button
              onClick={onBack}
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-foreground disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </>
      )}
    </div>
  );
}
