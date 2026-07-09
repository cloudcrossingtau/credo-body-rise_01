import { useState } from "react";
import type { SyncItem } from "@/lib/sync";

// モバイル版「推移」。カテゴリごとの実施頻度の推移を棒グラフで並べる。
// admin の ItemTrend と同じロジック（単一ユーザー向けに簡素化）。

type Item = SyncItem;
type Minutes = Record<string, number>;
type Gran = "week" | "month";
type CatMetric = "days" | "total";
const UNCAT_KEY = "__uncat__";
const MONTHS = 12;
const WEEKS = 12;

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

type Bucket = { label: string; s: string; e: string };
function monthBuckets(today: Date): Bucket[] {
  const out: Bucket[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({
      label: `${d.getMonth() + 1}月`,
      s: ymd(new Date(d.getFullYear(), d.getMonth(), 1)),
      e: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    });
  }
  return out;
}
function weekBuckets(today: Date, weekStart: number): Bucket[] {
  const cur = startOfWeek(today, weekStart);
  const out: Bucket[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = addDays(cur, -i * 7);
    out.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      s: ymd(start),
      e: ymd(addDays(start, 6)),
    });
  }
  return out;
}

type Target = { id: string; name: string; color: string; dates: string[] };

function buildTargets(
  items: Item[],
  minutes: Minutes,
  metric: CatMetric,
): Target[] {
  const datesByItem = new Map<string, Set<string>>();
  for (const k of Object.keys(minutes)) {
    if ((minutes[k] ?? 0) <= 0) continue;
    const idx = k.indexOf(":");
    const itemId = k.slice(0, idx);
    const date = k.slice(idx + 1);
    const set = datesByItem.get(itemId) ?? new Set<string>();
    set.add(date);
    datesByItem.set(itemId, set);
  }
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
      <div className="flex h-24 items-end gap-1">
        {values.map((v, i) => (
          <div
            key={i}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
          >
            {v > 0 && (
              <span className="text-[11px] font-semibold text-slate-600">{v}</span>
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

export function MobileTrend({
  items,
  minutes,
  weekStart,
}: {
  items: Item[];
  minutes: Minutes;
  weekStart: number;
}) {
  const [gran, setGran] = useState<Gran>("week");
  const [catMetric, setCatMetric] = useState<CatMetric>("days");

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
  const buckets =
    gran === "month" ? monthBuckets(today) : weekBuckets(today, weekStart);
  const targets = buildTargets(items, minutes, catMetric)
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-slate-300 p-0.5">
          <button onClick={() => setGran("week")} className={pill(gran === "week")}>
            週（直近{WEEKS}週）
          </button>
          <button onClick={() => setGran("month")} className={pill(gran === "month")}>
            月（直近{MONTHS}ヶ月）
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
      </div>

      {!anyData ? (
        <p className="py-10 text-center text-[15px] text-muted">
          表示できる実施記録がありません。
        </p>
      ) : (
        <div className="mt-3 space-y-4">
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
      )}
    </div>
  );
}
