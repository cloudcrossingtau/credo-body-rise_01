import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pullRemote } from "@/lib/sync";
import { getMyProfile, getAvatarUrl, roleLabel } from "@/lib/profile";
import { pullAllUserGrids, type UserGrid } from "@/lib/devData";
import { Avatar } from "@/components/Avatar";
import { RefreshButton } from "@/components/RefreshButton";
import { withRetry, autoReloadOnce } from "@/lib/recover";
import {
  type Item,
  type Minutes,
  ymd,
  addDays,
  startOfDay,
  startOfWeek,
} from "@/lib/training";

const UNCAT_KEY = "__uncat__";

// 推移（試作）。項目 or カテゴリごとに、過去数ヶ月（or 数週間）の実施日数の推移を
// 棒グラフで並べる。長期的な増減の傾向を客観的に見るためのもの。

type ViewMode = "category" | "item";
type Gran = "month" | "week";
// days=実施日数(同カテゴリ複数でも1日1) / total=のべ回数(項目ごとの実施を合計)
type CatMetric = "days" | "total";
const MONTHS = 12; // 月表示のさかのぼり月数
const WEEKS = 12; // 週表示のさかのぼり週数

type Bucket = { label: string; s: string; e: string };

function monthBuckets(today: Date): Bucket[] {
  const out: Bucket[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); // 月末日
    out.push({ label: `${d.getMonth() + 1}月`, s: ymd(start), e: ymd(end) });
  }
  return out;
}
function weekBuckets(today: Date, weekStart: number): Bucket[] {
  const cur = startOfWeek(today, weekStart);
  const out: Bucket[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = addDays(cur, -i * 7);
    const end = addDays(start, 6);
    out.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      s: ymd(start),
      e: ymd(end),
    });
  }
  return out;
}

type Target = {
  id: string;
  name: string;
  color: string;
  // 実施した日付。days=重複なし / total=項目ごとの実施を積む（同日に同カテゴリ複数なら重複）。
  dates: string[];
};

// 対象（項目 or カテゴリ）ごとに、実施日付の配列を作る。
function buildTargets(
  items: Item[],
  minutes: Minutes,
  mode: ViewMode,
  metric: CatMetric,
): Target[] {
  const datesByItem = new Map<string, Set<string>>();
  for (const key of Object.keys(minutes)) {
    if ((minutes[key] ?? 0) <= 0) continue;
    const idx = key.indexOf(":");
    const itemId = key.slice(0, idx);
    const date = key.slice(idx + 1);
    const set = datesByItem.get(itemId) ?? new Set<string>();
    set.add(date);
    datesByItem.set(itemId, set);
  }

  if (mode === "item") {
    // 1項目は1日0/1なので days/total とも同じ。
    return items.map((it) => ({
      id: it.id,
      name: it.name,
      color: it.color,
      dates: [...(datesByItem.get(it.id) ?? [])],
    }));
  }

  // カテゴリ: 同カテゴリの項目の実施日を統合。
  //   days  … 同日に複数項目でも1日（重複除去）。
  //   total … 項目ごとの実施を積む（のべ回数）。
  const order: string[] = [];
  const color = new Map<string, string>();
  const name = new Map<string, string>();
  const dates = new Map<string, string[]>();
  for (const it of items) {
    const key = it.categoryId ?? UNCAT_KEY;
    if (!dates.has(key)) {
      dates.set(key, []);
      color.set(key, it.color);
      name.set(key, it.categoryName);
      order.push(key);
    }
    dates.get(key)!.push(...(datesByItem.get(it.id) ?? []));
  }
  return order.map((key) => {
    const arr = dates.get(key)!;
    return {
      id: key,
      name: name.get(key)!,
      color: color.get(key)!,
      dates: metric === "days" ? [...new Set(arr)] : arr,
    };
  });
}

function countInRange(dates: string[], s: string, e: string): number {
  let n = 0;
  for (const d of dates) if (d >= s && d <= e) n++;
  return n;
}

// 1対象ぶんの推移バーチャート。
function TrendChart({
  name,
  color,
  buckets,
  values,
}: {
  name: string;
  color: string;
  buckets: Bucket[];
  values: number[];
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="rounded-2xl border border-card-border bg-card-bg p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-[15px] font-semibold text-slate-800">{name}</span>
      </div>
      <div className="flex h-28 items-end gap-1">
        {values.map((v, i) => (
          <div
            key={i}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
          >
            {v > 0 && (
              <span className="text-[11px] font-semibold text-slate-600">
                {v}
              </span>
            )}
            <div
              className="w-full max-w-6 rounded-t"
              style={{
                height: `${(v / max) * 100}%`,
                minHeight: v > 0 ? 4 : 0,
                backgroundColor: color,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 text-center text-[11px] text-muted">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function UserTrend({
  items,
  minutes,
  weekStart,
  mode,
  gran,
  catMetric,
}: {
  items: Item[];
  minutes: Minutes;
  weekStart: number;
  mode: ViewMode;
  gran: Gran;
  catMetric: CatMetric;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-[15px] text-muted">種目がありません。</p>
    );
  }
  const today = startOfDay(new Date());
  const buckets =
    gran === "month" ? monthBuckets(today) : weekBuckets(today, weekStart);
  const targets = buildTargets(items, minutes, mode, catMetric)
    .map((t) => ({
      ...t,
      values: buckets.map((b) => countInRange(t.dates, b.s, b.e)),
    }))
    .sort(
      (a, b) =>
        b.values.reduce((s, v) => s + v, 0) -
        a.values.reduce((s, v) => s + v, 0),
    );

  const anyData = targets.some((t) => t.values.some((v) => v > 0));
  if (!anyData) {
    return (
      <p className="py-6 text-center text-[15px] text-muted">
        表示できる実施記録がありません。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {targets.map((t) => (
        <TrendChart
          key={t.id}
          name={t.name}
          color={t.color}
          buckets={buckets}
          values={t.values}
        />
      ))}
    </div>
  );
}

export function ItemTrend({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 「項目別」は廃止しカテゴリ別に固定（項目単位は細かすぎるため）。
  const [mode] = useState<ViewMode>("category");
  const [gran, setGran] = useState<Gran>("week");
  const [catMetric, setCatMetric] = useState<CatMetric>("days");

  // 本人用
  const [items, setItems] = useState<Item[]>([]);
  const [minutes, setMinutes] = useState<Minutes>({});
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
          setItems(remote.items);
          setMinutes(remote.minutes);
          if (remote.weekStart != null) setWeekStart(remote.weekStart);
        }
      }
      setLoaded(true);
    } catch (e) {
      console.warn("[trend] load failed:", e);
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

  const seg = (active: boolean) =>
    `rounded-md px-3 py-1 text-[15px] font-medium transition-colors ${
      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
    }`;
  const controls = (
    <div className="flex flex-wrap items-center gap-4">
      {/* 期間 */}
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {(["week", "month"] as Gran[]).map((g) => (
          <button key={g} onClick={() => setGran(g)} className={seg(gran === g)}>
            {g === "month" ? `月（直近${MONTHS}ヶ月）` : `週（直近${WEEKS}週）`}
          </button>
        ))}
      </div>
      {/* 指標 */}
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {(["days", "total"] as CatMetric[]).map((cm) => (
          <button
            key={cm}
            onClick={() => setCatMetric(cm)}
            className={seg(catMetric === cm)}
          >
            {cm === "days" ? "実施日数" : "のべ回数"}
          </button>
        ))}
      </div>
    </div>
  );

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

  const desc = "項目/カテゴリごとの実施頻度の推移（増減の傾向）を確認できます。";

  // ===== 管理者/開発者: 全ユーザー =====
  if (isManager) {
    return (
      <div className={embedded ? "" : "mx-auto max-w-5xl p-6"}>
        {!embedded && (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-foreground">
                推移
              </h2>
              <RefreshButton onClick={loadData} />
            </div>
            <p className="mb-4 text-[13px] text-muted">
              {desc}登録ユーザー {userGrids.length} 名。
            </p>
          </>
        )}
        <div className="mb-6">{controls}</div>

        <div className="space-y-10">
          {userGrids.map((u) => {
            const name =
              u.nickname?.trim() || u.email?.split("@")[0] || "（名称未設定）";
            return (
              <section key={u.id}>
                <div className="mb-3 flex items-center gap-3">
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
                  </div>
                </div>
                <UserTrend
                  items={u.items}
                  minutes={u.minutes}
                  weekStart={u.weekStart}
                  mode={mode}
                  gran={gran}
                  catMetric={catMetric}
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

  // ===== 一般ユーザー: 自分 =====
  return (
    <div className={embedded ? "" : "mx-auto max-w-5xl p-6"}>
      {!embedded && (
        <>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[20px] font-semibold text-foreground">推移</h2>
            <RefreshButton onClick={loadData} />
          </div>
          <p className="mb-4 text-[13px] text-muted">{desc}</p>
        </>
      )}
      <div className="mb-6">{controls}</div>
      <UserTrend
        items={items}
        minutes={minutes}
        weekStart={weekStart}
        mode={mode}
        gran={gran}
        catMetric={catMetric}
      />
    </div>
  );
}
