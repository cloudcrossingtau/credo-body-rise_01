import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pullRemote } from "@/lib/sync";
import { getMyProfile, getAvatarUrl, roleLabel } from "@/lib/profile";
import { pullAllUserGrids, type UserGrid } from "@/lib/devData";
import { UserCharts } from "@/components/UserCharts";
import { Avatar } from "@/components/Avatar";
import { RefreshButton } from "@/components/RefreshButton";
import { withRetry, autoReloadOnce } from "@/lib/recover";

// グラフ。ロールで見える範囲が変わる:
//   - 一般ユーザー: 自分のグラフ。
//   - 管理者/開発者: 全ユーザーのグラフをユーザーごとに表示。
export function Charts({ embedded = false }: { embedded?: boolean } = {}) {
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 本人用（グラフは日別合計時間のみ使用）
  const [dayMinutes, setDayMinutes] = useState<Record<string, number>>({});
  const [weekStart, setWeekStart] = useState<number>(1);

  // 管理者/開発者用
  const [userGrids, setUserGrids] = useState<UserGrid[]>([]);

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
          setDayMinutes(remote.dayMinutes);
          if (remote.weekStart != null) setWeekStart(remote.weekStart);
        }
      }
      setLoaded(true);
    } catch (e) {
      console.warn("[charts] load failed:", e);
      if (!autoReloadOnce()) {
        setLoadError("データの読み込みに失敗しました。通信状況を確認してください。");
      }
    }
  }
  useEffect(() => {
    loadData();
  }, []);

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

  // ===== 管理者/開発者: 全ユーザーのグラフ =====
  if (isManager) {
    return (
      <div className={embedded ? "" : "mx-auto max-w-5xl p-6"}>
        {!embedded && (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-foreground">
                グラフ
              </h2>
              <RefreshButton onClick={loadData} />
            </div>
            <p className="mb-5 text-[13px] text-muted">
              全ユーザーのグラフを表示しています（{roleLabel(role ?? "")}）。登録ユーザー{" "}
              {userGrids.length} 名。
            </p>
          </>
        )}

        <div className="space-y-10">
          {userGrids.map((u) => {
            const name =
              u.nickname?.trim() || u.email?.split("@")[0] || "（名称未設定）";
            return (
              <section key={u.id}>
                <div className="mb-1 flex items-center gap-3">
                  <Avatar
                    url={getAvatarUrl(u.avatarPath)}
                    fallback={name.charAt(0).toUpperCase()}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-foreground">
                      {name}
                      <span className="ml-2 align-middle text-[12px] font-normal text-muted">
                        {roleLabel(u.role)}
                      </span>
                    </p>
                    <p className="truncate text-[12px] text-muted">
                      {u.email ?? "-"}
                    </p>
                  </div>
                </div>
                <UserCharts dayMinutes={u.dayMinutes} weekStart={u.weekStart} />
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

  // ===== 一般ユーザー: 自分のグラフ =====
  return (
    <div className={embedded ? "" : "mx-auto max-w-5xl p-6"}>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-foreground">グラフ</h2>
          <RefreshButton onClick={loadData} />
        </div>
      )}
      <UserCharts dayMinutes={dayMinutes} weekStart={weekStart} />
    </div>
  );
}
