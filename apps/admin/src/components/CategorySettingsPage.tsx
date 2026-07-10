import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { withRetry, autoReloadOnce } from "@/lib/recover";
import {
  type Category,
  pullCategories,
  saveCategories,
  categoryUuid,
} from "@/lib/categories";
import { COLOR_CHOICES } from "@/lib/training";
import { UserScopeSelect } from "@/components/UserScopeSelect";

// カテゴリ管理（本採用）。名前＋色を設定する。項目はこのカテゴリを選んで分類する。
// カテゴリを削除すると、そのカテゴリの項目は「未分類」になる（記録は消えない）。

export function CategorySettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [target, setTarget] = useState<string | null>(null); // null=自分

  async function loadData(t: string | null = target) {
    setLoaded(false);
    setLoadError(null);
    try {
      if (!supabase) {
        setLoaded(true);
        return;
      }
      setCats(
        await withRetry(() => pullCategories(t ?? undefined), {
          timeoutMs: 5000,
          maxAttempts: 3,
          label: "pullCategories",
        }),
      );
      setLoaded(true);
    } catch (e) {
      console.warn("[categories] load failed:", e);
      if (!autoReloadOnce()) {
        setLoadError(
          "データの読み込みに失敗しました。通信状況を確認してください。",
        );
      }
    }
  }
  useEffect(() => {
    loadData();
  }, []);

  function addCat() {
    // まだ使っていない色を初期色に選ぶ。
    const used = new Set(cats.map((c) => c.color));
    const color = COLOR_CHOICES.find((c) => !used.has(c)) ?? COLOR_CHOICES[0];
    setCats((prev) => [...prev, { id: categoryUuid(), name: "", color }]);
    setSavedFlash(false);
  }
  function update(id: string, patch: Partial<Category>) {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSavedFlash(false);
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
    setSavedFlash(false);
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
    setSavedFlash(false);
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
      if (supabase) await saveCategories(clean, target ?? undefined);
      setCats(clean);
      setSavedFlash(true);
    } catch (e) {
      console.warn("[categories] save failed:", e);
      setError("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setBusy(false);
    }
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
      <h2 className="mb-1 text-[20px] font-semibold text-foreground">
        カテゴリ
      </h2>
      <p className="mb-4 text-[13px] text-muted">
        トレーニング項目を分類するカテゴリ（名前＋色）を設定します。項目の色はカテゴリの色になります。
      </p>

      <UserScopeSelect
        target={target}
        onChange={(id) => {
          setTarget(id);
          loadData(id);
        }}
      />

      <div className="space-y-2">
        {cats.map((c, idx) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-card-border bg-card-bg p-3"
          >
            <div className="flex flex-col">
              <button
                onClick={() => move(c.id, -1)}
                disabled={idx === 0}
                className="px-1 text-[14px] leading-tight text-slate-600 disabled:opacity-30"
                aria-label="上へ"
              >
                ▲
              </button>
              <button
                onClick={() => move(c.id, 1)}
                disabled={idx === cats.length - 1}
                className="px-1 text-[14px] leading-tight text-slate-600 disabled:opacity-30"
                aria-label="下へ"
              >
                ▼
              </button>
            </div>
            <div className="flex shrink-0 gap-1">
              {COLOR_CHOICES.map((col) => (
                <button
                  key={col}
                  onClick={() => update(c.id, { color: col })}
                  aria-label={col}
                  className={`h-6 w-6 rounded-full ${
                    c.color === col
                      ? "ring-2 ring-slate-800 ring-offset-1"
                      : ""
                  }`}
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
            <input
              type="text"
              value={c.name}
              onChange={(e) => update(c.id, { name: e.target.value })}
              placeholder="カテゴリ名（例：筋力）"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-card-bg px-3 py-2 text-[15px] text-slate-900 placeholder:text-slate-400"
            />
            <button
              onClick={() => remove(c.id)}
              className="shrink-0 rounded-lg px-2 py-1 text-[14px] font-medium text-red-500 hover:bg-red-50"
            >
              削除
            </button>
          </div>
        ))}
        {cats.length === 0 && (
          <p className="py-6 text-center text-[15px] text-muted">
            カテゴリがありません。「＋ カテゴリを追加」から作成してください。
          </p>
        )}
      </div>

      <button
        onClick={addCat}
        className="mt-3 rounded-xl border border-slate-300 bg-card-bg px-4 py-2 text-[15px] font-medium text-accent"
      >
        ＋ カテゴリを追加
      </button>

      {error && (
        <p className="mt-4 text-[14px] font-medium text-red-600">{error}</p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={busy}
          className="rounded-xl bg-accent px-5 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        {savedFlash && (
          <span className="text-[14px] font-medium text-green-600">
            保存しました
          </span>
        )}
      </div>
    </div>
  );
}
