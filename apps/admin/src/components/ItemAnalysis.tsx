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

// 項目分析（試作）。トレーニング項目は「実施したか/してないか」の○×のみなので、
// 客観指標として「その期間に各項目を何日実施したか（実施回数）」を集計して表示する。
// 提案や警告はせず、事実（実施回数の分布）だけを見やすく示す。

type ViewMode = "category" | "item";
// カテゴリ別の数え方: days=実施日数(同カテゴリ複数でも1日1) / total=のべ回数(項目合計)
type CatMetric = "days" | "total";

type Period = "week" | "month";
const PERIODS: Period[] = ["week", "month"];
const PERIOD_LABEL: Record<Period, string> = {
  week: "今週",
  month: "今月",
};

function periodStart(p: Period, today: Date, weekStart: number): Date {
  // 今週=週開始曜日(設定)に従う起点。今月=カレンダー上の1日。
  if (p === "week") return startOfWeek(today, weekStart);
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

type Row = {
  id: string;
  name: string;
  color: string;
  count: number;
  categoryId: string | null;
  categoryName: string;
};
const UNCAT_KEY = "__uncat__";
// 比較表示用: cur=今期間, prev=前期間（比較OFF時は null）。
type CmpRow = {
  id: string;
  name: string;
  color: string;
  cur: number;
  prev: number | null;
};

// 前期間のウィンドウ（前週／前月まるごと）。
//   今週 ⇔ 前週(週開始の7日前〜今週開始の前日) / 今月 ⇔ 前月(1日〜前月末日)。
//   「同じ経過ぶん」だと週/月の初日には前期間も1日分しか見ず実績が隠れるため、
//   参照として使いやすいよう前期間は全体を対象にする。
function prevWindow(
  period: Period,
  today: Date,
  weekStart: number,
): { start: Date; end: Date } {
  if (period === "week") {
    const curStart = startOfWeek(today, weekStart);
    return { start: addDays(curStart, -7), end: addDays(curStart, -1) };
  }
  const y = today.getFullYear();
  const m = today.getMonth();
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) }; // 前月1日〜末日
}

// 期間内に各項目を実施した「日数」を数える（○×なので値>0＝実施1回）。
function countRows(
  items: Item[],
  minutes: Minutes,
  start: Date,
  today: Date,
): Row[] {
  const s = ymd(start);
  const e = ymd(today);
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.id, 0);
  for (const key of Object.keys(minutes)) {
    if ((minutes[key] ?? 0) <= 0) continue;
    const idx = key.indexOf(":");
    const itemId = key.slice(0, idx);
    const date = key.slice(idx + 1);
    if (date >= s && date <= e && counts.has(itemId)) {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
  }
  return items.map((it) => ({
    id: it.id,
    name: it.name,
    color: it.color,
    count: counts.get(it.id) ?? 0,
    categoryId: it.categoryId,
    categoryName: it.categoryName,
  }));
}

// 項目別の行を、各項目のカテゴリで合算する（のべ回数＝項目の実施日数の合計）。
function toCategoryRows(itemRows: Row[]): Row[] {
  const byCat = new Map<string, { count: number; color: string; name: string }>();
  const order: string[] = [];
  for (const r of itemRows) {
    const key = r.categoryId ?? UNCAT_KEY;
    const cur = byCat.get(key);
    if (cur) {
      cur.count += r.count;
    } else {
      byCat.set(key, { count: r.count, color: r.color, name: r.categoryName });
      order.push(key);
    }
  }
  return order.map((key) => {
    const v = byCat.get(key)!;
    return {
      id: key,
      name: v.name,
      color: v.color,
      count: v.count,
      categoryId: key === UNCAT_KEY ? null : key,
      categoryName: v.name,
    };
  });
}

// カテゴリ別（実施日数）。同じカテゴリの項目を1日に複数やっても「1日」と数える。
// ＝カテゴリを1つでも実施した日数。項目数の多いカテゴリが不当に伸びるのを防ぐ。
function categoryDayRows(
  items: Item[],
  minutes: Minutes,
  start: Date,
  today: Date,
): Row[] {
  const s = ymd(start);
  const e = ymd(today);
  const catOfItem = new Map<string, string>(); // itemId -> catKey
  for (const it of items) catOfItem.set(it.id, it.categoryId ?? UNCAT_KEY);
  // カテゴリの並び順・名前・色を項目順から決める。
  const catColor = new Map<string, string>();
  const catName = new Map<string, string>();
  const order: string[] = [];
  for (const it of items) {
    const key = it.categoryId ?? UNCAT_KEY;
    if (!catColor.has(key)) {
      catColor.set(key, it.color);
      catName.set(key, it.categoryName);
      order.push(key);
    }
  }
  const daysByCat = new Map<string, Set<string>>();
  for (const key of Object.keys(minutes)) {
    if ((minutes[key] ?? 0) <= 0) continue;
    const idx = key.indexOf(":");
    const itemId = key.slice(0, idx);
    const date = key.slice(idx + 1);
    if (date < s || date > e) continue;
    const catKey = catOfItem.get(itemId);
    if (catKey === undefined) continue;
    const set = daysByCat.get(catKey) ?? new Set<string>();
    set.add(date);
    daysByCat.set(catKey, set);
  }
  return order.map((key) => ({
    id: key,
    name: catName.get(key)!,
    color: catColor.get(key)!,
    count: daysByCat.get(key)?.size ?? 0,
    categoryId: key === UNCAT_KEY ? null : key,
    categoryName: catName.get(key)!,
  }));
}

// 指定ウィンドウの行を、現在の表示モード（カテゴリ別・日数/のべ）で集計する。
function rowsFor(
  mode: ViewMode,
  catMetric: CatMetric,
  items: Item[],
  minutes: Minutes,
  start: Date,
  end: Date,
): Row[] {
  if (mode === "category" && catMetric === "days") {
    return categoryDayRows(items, minutes, start, end);
  }
  const itemRows = countRows(items, minutes, start, end);
  return mode === "category" ? toCategoryRows(itemRows) : itemRows;
}

// レーダー（3項目以上のとき）。各軸=項目、長さ=実施回数。バランスの偏りを客観表示。
// 比較ONのときは前期間の多角形を破線で重ねる。
function Radar({
  rows,
  max,
  showPrev,
}: {
  rows: CmpRow[];
  max: number;
  showPrev: boolean;
}) {
  const data = rows;
  const N = data.length;
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const R = 96;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const pt = (i: number, v: number): [number, number] => [
    cx + R * v * Math.cos(angle(i)),
    cy + R * v * Math.sin(angle(i)),
  ];
  const poly = (pts: [number, number][]) =>
    pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  // 実施回数（整数）なので、目盛りは整数刻みにする。値が大きい時は見やすい刻み(2/5/10…)に。
  const step =
    max <= 6
      ? 1
      : (() => {
          const raw = max / 5;
          const pow = Math.pow(10, Math.floor(Math.log10(raw)));
          return (
            [1, 2, 2.5, 5, 10].map((c) => c * pow).find((c) => c >= raw) ??
            10 * pow
          );
        })();
  const scaleMax = Math.max(step, Math.ceil(max / step) * step);
  const ringFractions: number[] = [];
  for (let v = step; v <= scaleMax + 1e-9; v += step)
    ringFractions.push(v / scaleMax);
  const dataPts = data.map((d, i) => pt(i, d.cur / scaleMax));
  const prevPts = data.map((d, i) => pt(i, (d.prev ?? 0) / scaleMax));
  // ラベルが円の外側にはみ出るぶん、描画枠に左右・上下の余白を確保して切れないようにする。
  const PAD_X = 78;
  const PAD_Y = 16;

  return (
    <svg
      viewBox={`${-PAD_X} ${-PAD_Y} ${size + PAD_X * 2} ${size + PAD_Y * 2}`}
      className="mx-auto block h-auto w-full max-w-md"
    >
      {/* 目盛りリング（整数刻み） */}
      {ringFractions.map((r, ri) => (
        <polygon
          key={ri}
          points={poly(data.map((_, i) => pt(i, r)))}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}
      {/* 軸線 */}
      {data.map((_, i) => {
        const [x, y] = pt(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        );
      })}
      {/* 前期間の多角形（破線・薄い） */}
      {showPrev && (
        <polygon
          points={poly(prevPts)}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
      {/* 今期間の多角形 */}
      <polygon
        points={poly(dataPts)}
        fill="rgba(37,99,235,0.18)"
        stroke="#2563eb"
        strokeWidth={2}
      />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="#2563eb" />
      ))}
      {/* ラベル（項目名＋回数） */}
      {data.map((d, i) => {
        const [x, y] = pt(i, 1.14);
        const a = angle(i);
        const anchor =
          Math.abs(Math.cos(a)) < 0.3
            ? "middle"
            : Math.cos(a) > 0
              ? "start"
              : "end";
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-slate-700"
            style={{ fontSize: 11 }}
          >
            {d.name.length > 8 ? d.name.slice(0, 8) + "…" : d.name}（{d.cur}
            {showPrev ? `／${d.prev ?? 0}` : ""}）
          </text>
        );
      })}
    </svg>
  );
}

// 増減バッジ（今 − 前）。増=緑 +n / 減=赤 −n / 同=灰 ±0。
function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = cur - prev;
  if (d === 0)
    return <span className="text-[13px] font-medium text-slate-400">±0</span>;
  const up = d > 0;
  return (
    <span
      className={`text-[13px] font-semibold ${up ? "text-green-600" : "text-red-500"}`}
    >
      {up ? "+" : "−"}
      {Math.abs(d)}
    </span>
  );
}

// 横棒（実施回数ランキング）。項目が多くても崩れず、正確な回数が読める。
// 比較ONのときは各行に前期間の細いバー＋増減を併記する。
function BarList({
  rows,
  max,
  showPrev,
}: {
  rows: CmpRow[];
  max: number;
  showPrev: boolean;
}) {
  const sorted = [...rows].sort((a, b) => b.cur - a.cur);
  const w = (n: number) => `${max > 0 ? (n / max) * 100 : 0}%`;
  return (
    <div className="mt-4 space-y-2.5">
      {sorted.map((d) => (
        <div key={d.id} className="flex items-center gap-3">
          <div
            className="w-28 shrink-0 truncate text-[15px] text-slate-800"
            title={d.name}
          >
            {d.name}
          </div>
          {showPrev ? (
            // 上下型: 今(色)と前(グレー)の細いバーを隙間なく縦に並べる。
            <div className="flex-1 space-y-0.5">
              <div className="h-3 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded"
                  style={{ width: w(d.cur), backgroundColor: d.color }}
                />
              </div>
              <div className="h-3 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-slate-300"
                  style={{ width: w(d.prev ?? 0) }}
                />
              </div>
            </div>
          ) : (
            <div className="h-5.5 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded"
                style={{ width: w(d.cur), backgroundColor: d.color }}
              />
            </div>
          )}
          {showPrev ? (
            <div className="flex w-20 shrink-0 items-center justify-end gap-1.5 tabular-nums">
              <span className="text-[15px] font-semibold text-slate-800">
                {d.cur}
              </span>
              <span className="text-[13px] text-slate-400">/{d.prev ?? 0}</span>
              <Delta cur={d.cur} prev={d.prev ?? 0} />
            </div>
          ) : (
            <div className="w-6 text-right text-[15px] font-semibold tabular-nums text-slate-800">
              {d.cur}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemCharts({
  items,
  minutes,
  weekStart,
  period,
  mode,
  catMetric,
  compare,
}: {
  items: Item[];
  minutes: Minutes;
  weekStart: number;
  period: Period;
  mode: ViewMode;
  catMetric: CatMetric;
  compare: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-[15px] text-muted">種目がありません。</p>
    );
  }
  const today = startOfDay(new Date());
  const start = periodStart(period, today, weekStart);
  const curRows = rowsFor(mode, catMetric, items, minutes, start, today);

  let prevById: Map<string, number> | null = null;
  if (compare) {
    const pw = prevWindow(period, today, weekStart);
    const prevRows = rowsFor(mode, catMetric, items, minutes, pw.start, pw.end);
    prevById = new Map(prevRows.map((r) => [r.id, r.count]));
  }

  const rows: CmpRow[] = curRows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    cur: r.count,
    prev: compare ? (prevById?.get(r.id) ?? 0) : null,
  }));

  // 記録が無くても「空のグラフ（ゼロ状態）」を表示する（比較も出せるように）。
  // max は最低1で保護してあるので、全ゼロでもレイアウトは崩れない。
  const max = Math.max(
    1,
    ...rows.map((r) => r.cur),
    ...(compare ? rows.map((r) => r.prev ?? 0) : []),
  );
  const prevLabel = period === "week" ? "前週" : "前月";

  return (
    <div className="rounded-2xl border border-card-border bg-card-bg p-4">
      {compare && (
        <div className="mb-2 flex items-center gap-4 text-[13px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-accent" />
            {PERIOD_LABEL[period]}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-slate-400" />
            {prevLabel}（全体）
          </span>
        </div>
      )}
      {items.length >= 3 && <Radar rows={rows} max={max} showPrev={compare} />}
      <BarList rows={rows} max={max} showPrev={compare} />
    </div>
  );
}

export function ItemAnalysis() {
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  // 「項目別」は廃止しカテゴリ別に固定（項目単位は細かすぎるため）。
  const [mode] = useState<ViewMode>("category");
  const [catMetric, setCatMetric] = useState<CatMetric>("days");
  const [compare, setCompare] = useState(true);

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
      console.warn("[analysis] load failed:", e);
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

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-full border border-slate-300 p-0.5">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-full px-3 py-1 text-[15px] font-medium ${
              period === p ? "bg-accent text-white" : "text-slate-700"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="inline-flex rounded-full border border-slate-300 p-0.5">
        {(["days", "total"] as CatMetric[]).map((cm) => (
          <button
            key={cm}
            onClick={() => setCatMetric(cm)}
            className={`rounded-full px-3 py-1 text-[15px] font-medium ${
              catMetric === cm ? "bg-accent text-white" : "text-slate-700"
            }`}
          >
            {cm === "days" ? "実施日数" : "のべ回数"}
          </button>
        ))}
      </div>
      <button
        onClick={() => setCompare((v) => !v)}
        className={`rounded-full border px-3 py-1 text-[15px] font-medium ${
          compare
            ? "border-accent bg-accent text-white"
            : "border-slate-300 text-slate-700"
        }`}
      >
        {period === "week" ? "前週と比較" : "前月と比較"}
      </button>
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

  // ===== 管理者/開発者: 全ユーザー =====
  if (isManager) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-foreground">バランス</h2>
          <RefreshButton onClick={loadData} />
        </div>
        <p className="mb-4 text-[13px] text-muted">
          その週/月のトレーニングの配分（バランス）を確認できます。登録ユーザー{" "}
          {userGrids.length} 名。
        </p>
        <div className="mb-6">{controls}</div>

        <div className="space-y-10">
          {userGrids.map((u) => {
            const name =
              u.nickname?.trim() || u.email?.split("@")[0] || "（名称未設定）";
            return (
              <section key={u.id}>
                <div className="mb-2 flex items-center gap-3">
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
                <ItemCharts
                  items={u.items}
                  minutes={u.minutes}
                  weekStart={u.weekStart}
                  period={period}
                  mode={mode}
                  catMetric={catMetric}
                  compare={compare}
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
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[20px] font-semibold text-foreground">バランス</h2>
        <RefreshButton onClick={loadData} />
      </div>
      <p className="mb-4 text-[13px] text-muted">
        その週/月のトレーニングの配分（バランス）を確認できます。
      </p>
      <div className="mb-6">{controls}</div>
      <ItemCharts
        items={items}
        minutes={minutes}
        weekStart={weekStart}
        period={period}
        mode={mode}
        catMetric={catMetric}
        compare={compare}
      />
    </div>
  );
}
