import { useState } from "react";
import type { SyncItem } from "@/lib/sync";

// モバイル版「バランス」。本人の項目×実施マークから、カテゴリ配分を表示する。
// admin の ItemAnalysis と同じロジック（単一ユーザー向けに簡素化）。

type Item = SyncItem;
type Minutes = Record<string, number>;
type Period = "week" | "month";
type CatMetric = "days" | "total";
const UNCAT_KEY = "__uncat__";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date, weekStart: number) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
}

function periodStart(p: Period, today: Date, weekStart: number): Date {
  if (p === "week") return startOfWeek(today, weekStart);
  return new Date(today.getFullYear(), today.getMonth(), 1);
}
function prevWindow(p: Period, today: Date, weekStart: number) {
  if (p === "week") {
    const cur = startOfWeek(today, weekStart);
    return { start: addDays(cur, -7), end: addDays(cur, -1) };
  }
  const y = today.getFullYear();
  const m = today.getMonth();
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
}

type Row = { id: string; name: string; color: string; count: number };

// カテゴリ別・実施日数（同カテゴリ複数でも1日1）。
function categoryDayRows(
  items: Item[],
  minutes: Minutes,
  start: Date,
  end: Date,
): Row[] {
  const s = ymd(start);
  const e = ymd(end);
  const catOfItem = new Map<string, string>();
  for (const it of items) catOfItem.set(it.id, it.categoryId ?? UNCAT_KEY);
  const color = new Map<string, string>();
  const name = new Map<string, string>();
  const order: string[] = [];
  for (const it of items) {
    const key = it.categoryId ?? UNCAT_KEY;
    if (!color.has(key)) {
      color.set(key, it.color);
      name.set(key, it.categoryName);
      order.push(key);
    }
  }
  const daysByCat = new Map<string, Set<string>>();
  for (const k of Object.keys(minutes)) {
    if ((minutes[k] ?? 0) <= 0) continue;
    const idx = k.indexOf(":");
    const itemId = k.slice(0, idx);
    const date = k.slice(idx + 1);
    if (date < s || date > e) continue;
    const catKey = catOfItem.get(itemId);
    if (catKey === undefined) continue;
    const set = daysByCat.get(catKey) ?? new Set<string>();
    set.add(date);
    daysByCat.set(catKey, set);
  }
  return order.map((key) => ({
    id: key,
    name: name.get(key)!,
    color: color.get(key)!,
    count: daysByCat.get(key)?.size ?? 0,
  }));
}

// カテゴリ別・のべ回数（項目ごとの実施日数を合計）。
function categoryTotalRows(
  items: Item[],
  minutes: Minutes,
  start: Date,
  end: Date,
): Row[] {
  const s = ymd(start);
  const e = ymd(end);
  const perItem = new Map<string, number>();
  for (const it of items) perItem.set(it.id, 0);
  for (const k of Object.keys(minutes)) {
    if ((minutes[k] ?? 0) <= 0) continue;
    const idx = k.indexOf(":");
    const itemId = k.slice(0, idx);
    const date = k.slice(idx + 1);
    if (date < s || date > e || !perItem.has(itemId)) continue;
    perItem.set(itemId, (perItem.get(itemId) ?? 0) + 1);
  }
  const byCat = new Map<string, { count: number; color: string; name: string }>();
  const order: string[] = [];
  for (const it of items) {
    const key = it.categoryId ?? UNCAT_KEY;
    const c = byCat.get(key);
    const add = perItem.get(it.id) ?? 0;
    if (c) c.count += add;
    else {
      byCat.set(key, { count: add, color: it.color, name: it.categoryName });
      order.push(key);
    }
  }
  return order.map((key) => {
    const v = byCat.get(key)!;
    return { id: key, name: v.name, color: v.color, count: v.count };
  });
}

function rowsFor(
  metric: CatMetric,
  items: Item[],
  minutes: Minutes,
  start: Date,
  end: Date,
): Row[] {
  return metric === "days"
    ? categoryDayRows(items, minutes, start, end)
    : categoryTotalRows(items, minutes, start, end);
}

type CmpRow = {
  id: string;
  name: string;
  color: string;
  cur: number;
  prev: number | null;
};

function Radar({
  rows,
  max,
  showPrev,
}: {
  rows: CmpRow[];
  max: number;
  showPrev: boolean;
}) {
  const N = rows.length;
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
  const dataPts = rows.map((d, i) => pt(i, d.cur / scaleMax));
  const prevPts = rows.map((d, i) => pt(i, (d.prev ?? 0) / scaleMax));
  const PAD_X = 78;
  const PAD_Y = 16;
  return (
    <svg
      viewBox={`${-PAD_X} ${-PAD_Y} ${size + PAD_X * 2} ${size + PAD_Y * 2}`}
      className="mx-auto block h-auto w-full max-w-md"
    >
      {ringFractions.map((r, ri) => (
        <polygon
          key={ri}
          points={poly(rows.map((_, i) => pt(i, r)))}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}
      {rows.map((_, i) => {
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
      {showPrev && (
        <polygon
          points={poly(prevPts)}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
      <polygon
        points={poly(dataPts)}
        fill="rgba(59,130,246,0.18)"
        stroke="#3b82f6"
        strokeWidth={2}
      />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="#3b82f6" />
      ))}
      {rows.map((d, i) => {
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
        <div key={d.id} className="flex items-center gap-2">
          <div
            className="w-20 shrink-0 truncate text-[14px] text-slate-800"
            title={d.name}
          >
            {d.name}
          </div>
          {showPrev ? (
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
            <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded"
                style={{ width: w(d.cur), backgroundColor: d.color }}
              />
            </div>
          )}
          {showPrev ? (
            <div className="flex w-16 shrink-0 items-center justify-end gap-1 tabular-nums">
              <span className="text-[14px] font-semibold text-slate-800">
                {d.cur}
              </span>
              <span className="text-[12px] text-slate-400">/{d.prev ?? 0}</span>
              <Delta cur={d.cur} prev={d.prev ?? 0} />
            </div>
          ) : (
            <div className="w-6 text-right text-[14px] font-semibold tabular-nums text-slate-800">
              {d.cur}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function MobileBalance({
  items,
  minutes,
  weekStart,
}: {
  items: Item[];
  minutes: Minutes;
  weekStart: number;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const [catMetric, setCatMetric] = useState<CatMetric>("days");
  const [compare, setCompare] = useState(true);

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-[14px] font-medium ${
      active ? "bg-accent text-white" : "text-slate-700"
    }`;

  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-[15px] text-muted">
        種目がありません。「設定」から登録してください。
      </p>
    );
  }

  const today = startOfDay(new Date());
  const start = periodStart(period, today, weekStart);
  const curRows = rowsFor(catMetric, items, minutes, start, today);
  let prevById: Map<string, number> | null = null;
  if (compare) {
    const pw = prevWindow(period, today, weekStart);
    const prevRows = rowsFor(catMetric, items, minutes, pw.start, pw.end);
    prevById = new Map(prevRows.map((r) => [r.id, r.count]));
  }
  const rows: CmpRow[] = curRows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    cur: r.count,
    prev: compare ? (prevById?.get(r.id) ?? 0) : null,
  }));
  const max = Math.max(
    1,
    ...rows.map((r) => r.cur),
    ...(compare ? rows.map((r) => r.prev ?? 0) : []),
  );
  const prevLabel = period === "week" ? "前週" : "前月";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-slate-300 p-0.5">
          <button onClick={() => setPeriod("week")} className={pill(period === "week")}>
            今週
          </button>
          <button onClick={() => setPeriod("month")} className={pill(period === "month")}>
            今月
          </button>
        </div>
        <div className="inline-flex rounded-full border border-slate-300 p-0.5">
          <button onClick={() => setCatMetric("days")} className={pill(catMetric === "days")}>
            実施日数
          </button>
          <button onClick={() => setCatMetric("total")} className={pill(catMetric === "total")}>
            のべ回数
          </button>
        </div>
        <button
          onClick={() => setCompare((v) => !v)}
          className={`rounded-full border px-3 py-1 text-[14px] font-medium ${
            compare ? "border-accent bg-accent text-white" : "border-slate-300 text-slate-700"
          }`}
        >
          {period === "week" ? "前週と比較" : "前月と比較"}
        </button>
      </div>

      <div className="mt-3 rounded-2xl border border-card-border bg-card-bg p-4">
        {compare && (
          <div className="mb-2 flex items-center gap-4 text-[13px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm bg-accent" />
              {period === "week" ? "今週" : "今月"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-4 border-t-2 border-dashed border-slate-400" />
              {prevLabel}（全体）
            </span>
          </div>
        )}
        {rows.length >= 3 && <Radar rows={rows} max={max} showPrev={compare} />}
        <BarList rows={rows} max={max} showPrev={compare} />
      </div>
    </div>
  );
}
