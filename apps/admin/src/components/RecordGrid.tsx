import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  pullRemote,
  saveRecord,
  deleteRecord,
  saveDayMinutes,
} from "@/lib/sync";
import { getMyProfile, getAvatarUrl, roleLabel } from "@/lib/profile";
import { pullAllUserGrids, type UserGrid } from "@/lib/devData";
import { TrainingGrid } from "@/components/TrainingGrid";
import { Avatar } from "@/components/Avatar";
import { RefreshButton } from "@/components/RefreshButton";
import { withRetry, autoReloadOnce } from "@/lib/recover";
import { type Item, type Minutes, ymd, WD, QUICK_TIME } from "@/lib/training";

// ホーム（記録）。
//   - 一般ユーザー: 自分のデータ（項目の実施チェック＋その日の合計時間を編集）。
//   - 管理者/開発者: 全ユーザーのデータをユーザーごとの表で表示（閲覧のみ）。
export function RecordGrid() {
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 一般ユーザー（本人）用
  const [items, setItems] = useState<Item[]>([]);
  const [minutes, setMinutes] = useState<Minutes>({}); // 実施マーク
  const [dayMinutes, setDayMinutes] = useState<Record<string, number>>({});
  const [weekStart, setWeekStart] = useState<number>(1);
  // グリッドは既定で参照モード。編集ボタンで切替（不用意な変更を防ぐ）。
  const [gridEditing, setGridEditing] = useState(false);

  // 管理者/開発者用（全ユーザー）
  const [userGrids, setUserGrids] = useState<UserGrid[]>([]);

  // 日別時間の入力モーダル（本人のみ）
  const [editingDay, setEditingDay] = useState<Date | null>(null);
  const [dayVal, setDayVal] = useState("");
  const [cellBusy, setCellBusy] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const isManager = role === "admin" || role === "developer";

  async function loadData() {
    setLoaded(false);
    setLoadError(null);
    try {
      if (!supabase) {
        setLoaded(true);
        return;
      }
      const p = await withRetry(() => getMyProfile(), {
        timeoutMs: 5000,
        maxAttempts: 3,
        label: "getMyProfile",
      });
      const r = p?.role ?? "general";
      setRole(r);
      if (r === "admin" || r === "developer") {
        setUserGrids(
          await withRetry(() => pullAllUserGrids(), {
            timeoutMs: 5000,
            maxAttempts: 3,
            label: "pullAllUserGrids",
          }),
        );
      } else {
        const remote = await withRetry(() => pullRemote(), {
          timeoutMs: 5000,
          maxAttempts: 3,
          label: "pullRemote",
        });
        if (remote) {
          setItems(remote.items);
          setMinutes(remote.minutes);
          setDayMinutes(remote.dayMinutes);
          if (remote.weekStart != null) setWeekStart(remote.weekStart);
        }
      }
      setLoaded(true);
    } catch (e) {
      console.warn("[home] load failed:", e);
      if (!autoReloadOnce()) {
        setLoadError("データの読み込みに失敗しました。通信状況を確認してください。");
      }
    }
  }
  useEffect(() => {
    loadData();
  }, []);

  // 項目の実施/未実施をトグル（即時保存）。
  async function toggleItem(itemId: string, d: Date) {
    const date = ymd(d);
    const key = `${itemId}:${date}`;
    const done = (minutes[key] ?? 0) > 0;
    try {
      if (supabase) {
        if (done) await deleteRecord(itemId, date);
        else await saveRecord(itemId, date, 1);
      }
      setMinutes((prev) => {
        const next = { ...prev };
        if (done) delete next[key];
        else next[key] = 1;
        return next;
      });
    } catch (e) {
      console.warn("[record] toggle failed:", e);
      alert("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    }
  }

  function openDayEditor(d: Date) {
    const cur = dayMinutes[ymd(d)] ?? 0;
    setEditingDay(d);
    setDayVal(cur ? String(cur) : "");
    setCellError(null);
  }
  async function applyDay() {
    if (!editingDay) return;
    const date = ymd(editingDay);
    const v = Math.max(0, Math.round(Number(dayVal) || 0));
    setCellBusy(true);
    setCellError(null);
    try {
      if (supabase) await saveDayMinutes(date, v);
      setDayMinutes((prev) => {
        const next = { ...prev };
        if (v > 0) next[date] = v;
        else delete next[date];
        return next;
      });
      setEditingDay(null);
    } catch (e) {
      console.warn("[record] day save failed:", e);
      setCellError("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setCellBusy(false);
    }
  }
  async function clearDay() {
    if (!editingDay) return;
    const date = ymd(editingDay);
    setCellBusy(true);
    setCellError(null);
    try {
      if (supabase) await saveDayMinutes(date, 0);
      setDayMinutes((prev) => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
      setEditingDay(null);
    } catch (e) {
      console.warn("[record] day clear failed:", e);
      setCellError("削除に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setCellBusy(false);
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

  // ===== 管理者/開発者: 全ユーザー（閲覧のみ）=====
  if (isManager) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-foreground">ホーム</h2>
          <RefreshButton onClick={loadData} />
        </div>
        <p className="mb-5 text-[13px] text-muted">
          全ユーザーの記録を表示しています（{roleLabel(role ?? "")}・閲覧専用）。
          登録ユーザー {userGrids.length} 名。
        </p>

        <div className="space-y-8">
          {userGrids.map((u) => {
            const avatarUrl = getAvatarUrl(u.avatarPath);
            const name = u.nickname?.trim() || u.email?.split("@")[0] || "（名称未設定）";
            return (
              <section key={u.id}>
                <div className="mb-2 flex items-center gap-3">
                  <Avatar url={avatarUrl} fallback={name.charAt(0).toUpperCase()} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-foreground">
                      {name}
                      <span className="ml-2 align-middle text-[12px] font-normal text-muted">
                        {roleLabel(u.role)}
                      </span>
                    </p>
                    <p className="truncate text-[12px] text-muted">{u.email ?? "-"}</p>
                  </div>
                </div>
                <TrainingGrid
                  items={u.items}
                  minutes={u.minutes}
                  dayMinutes={u.dayMinutes}
                  weekStart={u.weekStart}
                  readOnly
                  maxHeight="none"
                />
              </section>
            );
          })}
          {userGrids.length === 0 && (
            <p className="py-10 text-center text-[15px] text-muted">
              ユーザーがいません。
            </p>
          )}
        </div>
      </div>
    );
  }

  // ===== 一般ユーザー: 自分のデータ（編集可）=====
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-semibold text-foreground">ホーム</h2>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              onClick={() => setGridEditing((v) => !v)}
              className={`rounded-full border px-4 py-1.5 text-[14px] font-semibold ${
                gridEditing
                  ? "border-accent bg-accent text-white"
                  : "border-slate-300 bg-card-bg text-accent"
              }`}
            >
              {gridEditing ? "完了" : "編集"}
            </button>
          )}
          <RefreshButton onClick={loadData} />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-center text-[15px] text-muted">
          種目がありません。「設定」から登録してください。
        </p>
      ) : (
        <TrainingGrid
          items={items}
          minutes={minutes}
          dayMinutes={dayMinutes}
          weekStart={weekStart}
          readOnly={!gridEditing}
          onToggle={toggleItem}
          onEditDay={openDayEditor}
        />
      )}

      {/* 日別トレーニング時間の入力モーダル */}
      {editingDay && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
          onClick={() => setEditingDay(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card-bg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[16px] font-semibold text-slate-900">
              トレーニング時間
            </div>
            <div className="text-[13px] text-muted">
              {editingDay.getMonth() + 1}/{editingDay.getDate()}（
              {WD[editingDay.getDay()]}）
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={dayVal}
                onChange={(e) => setDayVal(e.target.value)}
                placeholder="0"
                autoFocus
                className="w-full rounded-lg border border-slate-300 bg-card-bg px-3 py-2.5 text-[18px] font-semibold text-slate-900 placeholder:text-slate-400"
              />
              <span className="text-[16px] font-medium text-slate-700">分</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_TIME.map((m) => (
                <button
                  key={m}
                  onClick={() => setDayVal(String(m))}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-[15px] font-medium text-slate-800 hover:bg-slate-200"
                >
                  {m}分
                </button>
              ))}
            </div>

            {cellError && (
              <p className="mt-4 text-[14px] font-medium text-red-600">{cellError}</p>
            )}

            <button
              onClick={applyDay}
              disabled={cellBusy}
              className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {cellBusy ? "保存中…" : "保存"}
            </button>
            <div className="mt-2 flex gap-2">
              <button
                onClick={clearDay}
                disabled={cellBusy}
                className="flex-1 rounded-xl border border-slate-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-slate-800 disabled:opacity-50"
              >
                クリア
              </button>
              <button
                onClick={() => setEditingDay(null)}
                disabled={cellBusy}
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
