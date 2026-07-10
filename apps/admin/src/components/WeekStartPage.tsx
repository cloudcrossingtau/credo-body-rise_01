import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pullRemote, saveWeekStart } from "@/lib/sync";
import { WD } from "@/lib/training";
import { UserScopeSelect } from "@/components/UserScopeSelect";

export function WeekStartPage() {
  const [weekStart, setWeekStart] = useState<number>(1);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null); // null=自分

  async function load(t: string | null) {
    if (!supabase) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    try {
      const remote = await pullRemote(t ?? undefined);
      if (remote?.weekStart != null) setWeekStart(remote.weekStart);
      else setWeekStart(1);
    } catch (e) {
      console.warn("[load] failed:", e);
    }
    setLoaded(true);
  }
  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(idx: number) {
    const prev = weekStart;
    setWeekStart(idx);
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      if (supabase) await saveWeekStart(idx, target ?? undefined);
      setMsg("保存しました。");
    } catch (e) {
      console.warn("[weekStart] save failed:", e);
      setError("保存に失敗しました。通信状況を確認してください。");
      setWeekStart(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="mb-5 flex items-center gap-2">
        <a
          href="/settings"
          className="rounded-lg px-2 py-1 text-[15px] text-accent hover:bg-slate-100"
        >
          ‹ 設定
        </a>
        <h2 className="text-[20px] font-semibold text-foreground">
          週の開始曜日
        </h2>
      </div>

      <UserScopeSelect
        target={target}
        onChange={(id) => {
          setTarget(id);
          setMsg(null);
          setError(null);
          load(id);
        }}
      />

      {!loaded ? (
        <p className="text-[15px] text-muted">読み込み中…</p>
      ) : (
        <>
          <div className="flex gap-1.5">
            {WD.map((w, idx) => (
              <button
                key={idx}
                onClick={() => pick(idx)}
                disabled={saving}
                className={`flex h-11 flex-1 items-center justify-center rounded-lg text-[15px] font-semibold disabled:opacity-60 ${
                  weekStart === idx
                    ? "bg-accent text-white"
                    : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-muted">
            グラフや週合計の集計の起点になります。
          </p>
          {error && <p className="mt-3 text-[14px] text-red-600">{error}</p>}
          {msg && <p className="mt-3 text-[14px] text-emerald-700">{msg}</p>}
        </>
      )}
    </div>
  );
}
