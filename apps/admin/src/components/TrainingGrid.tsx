import { useEffect, useRef } from "react";
import {
  type Item,
  type Minutes,
  ymd,
  addDays,
  startOfDay,
  startOfWeek,
  WD,
  GRID_PAST_DAYS,
  TIME_COLOR,
} from "@/lib/training";

const NAME_W = 140; // 種目名カラム幅(px)
const CELL_W = 48; // 1日セル幅(px)

// 記録グリッドの表示部品（データ取得はしない）。
//   - 先頭行「トレーニング時間」= その日の合計時間(分)。onEditDay(date) で編集。
//   - 各項目行 = 実施/未実施のチェック。onToggle(itemId, date) でトグル。
// readOnly=true では静的表示。
export function TrainingGrid({
  items,
  minutes,
  dayMinutes,
  weekStart,
  readOnly = false,
  onToggle,
  onEditDay,
  maxHeight = "calc(100dvh - 220px)",
}: {
  items: Item[];
  minutes: Minutes; // itemId:date -> 1（実施マーク）
  dayMinutes: Record<string, number>; // date -> 分
  weekStart: number;
  readOnly?: boolean;
  onToggle?: (itemId: string, date: Date) => void;
  onEditDay?: (date: Date) => void;
  maxHeight?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = startOfDay(new Date());
  const todayStr = ymd(today);

  // 表示範囲：約 GRID_PAST_DAYS 日前〜今日。記録（実施マーク or 日別時間）が
  // それより古ければ最古の記録日まで遡る。
  const recYmds = [
    ...Object.keys(minutes).map((k) => k.slice(k.indexOf(":") + 1)),
    ...Object.keys(dayMinutes),
  ];
  const firstYmd = recYmds.length
    ? recYmds.reduce((a, b) => (a < b ? a : b))
    : todayStr;
  const [fy, fm, fd] = firstYmd.split("-").map(Number);
  let gStart = new Date(fy, fm - 1, fd);
  const gMinStart = addDays(today, -GRID_PAST_DAYS);
  if (gStart.getTime() > gMinStart.getTime()) gStart = gMinStart;
  const gCount =
    Math.round((today.getTime() - gStart.getTime()) / 86400000) + 1;
  const gridDays = Array.from({ length: gCount }, (_, i) => addDays(gStart, i));

  const monthSegments: { key: string; label: string; count: number }[] = [];
  for (const d of gridDays) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const key = `${y}-${m}`;
    const last = monthSegments[monthSegments.length - 1];
    if (last && last.key === key) last.count += 1;
    else monthSegments.push({ key, label: `${y}年${m + 1}月`, count: 1 });
  }

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, []);

  const ws = startOfWeek(today, weekStart);
  // 今週の合計時間（分）
  function weekMinutes() {
    let m = 0;
    for (let k = 0; k < 7; k++) m += dayMinutes[ymd(addDays(ws, k))] ?? 0;
    return m;
  }
  // 今週の実施日数（項目ごと）
  function weekDoneCount(itemId: string) {
    let c = 0;
    for (let k = 0; k < 7; k++) {
      if ((minutes[`${itemId}:${ymd(addDays(ws, k))}`] ?? 0) > 0) c++;
    }
    return c;
  }

  const cellCls = (d: Date) =>
    `flex h-12 shrink-0 items-center justify-center ${
      d.getDay() === weekStart ? "border-l border-slate-300" : ""
    }`;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto overscroll-none rounded-2xl border border-card-border bg-card-bg"
      style={{ maxHeight }}
    >
      <div style={{ minWidth: NAME_W + gridDays.length * CELL_W }}>
        {/* 日付ヘッダー */}
        <div className="sticky top-0 z-30 bg-card-bg">
          <div className="flex items-stretch">
            <div className="sticky left-0 z-40 bg-card-bg" style={{ width: NAME_W }} />
            {monthSegments.map((seg) => (
              <div
                key={seg.key}
                className="shrink-0 border-l border-slate-200 py-1 first:border-l-0"
                style={{ width: seg.count * CELL_W }}
              >
                <span
                  className="sticky inline-block px-1.5 text-[12px] font-semibold text-muted"
                  style={{ left: NAME_W }}
                >
                  {seg.label}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-stretch border-b border-card-border">
            <div
              className="sticky left-0 z-40 flex items-center border-r border-card-border bg-card-bg px-3 py-2 text-[15px] font-semibold text-slate-700"
              style={{ width: NAME_W }}
            >
              項目
            </div>
            {gridDays.map((d, i) => {
              const isToday = ymd(d) === todayStr;
              const wd = d.getDay();
              const isWeekStart = wd === weekStart;
              return (
                <div
                  key={i}
                  className={`shrink-0 py-2 text-center ${isWeekStart ? "border-l border-slate-300" : ""}`}
                  style={{ width: CELL_W }}
                >
                  <div
                    className={`text-[13px] ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : "text-muted"}`}
                  >
                    {WD[wd]}
                  </div>
                  <div
                    className={`mx-auto mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[14px] font-semibold ${isToday ? "bg-accent text-white" : "text-slate-800"}`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 合計トレーニング時間の行（見出し・親） */}
        <div className="flex items-stretch border-b border-blue-100 bg-blue-50">
          <div
            className="sticky left-0 z-10 flex items-center gap-2 border-r border-blue-100 bg-blue-50 px-3 py-2"
            style={{ width: NAME_W }}
          >
            <svg
              className="shrink-0"
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke={TIME_COLOR}
              strokeWidth={1.9}
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold text-blue-900">
                トレーニング時間
              </span>
              <span className="block text-[12px] text-muted">
                今週 {weekMinutes()}分
              </span>
            </span>
          </div>
          {gridDays.map((d, i) => {
            const v = dayMinutes[ymd(d)] ?? 0;
            const inner = (
              <span
                className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-[13px] font-semibold"
                style={v > 0 ? { backgroundColor: TIME_COLOR, color: "#fff" } : { color: "#cbd5e1" }}
              >
                {v > 0 ? v : "·"}
              </span>
            );
            return readOnly ? (
              <div key={i} className={cellCls(d)} style={{ width: CELL_W }}>
                {inner}
              </div>
            ) : (
              <button
                key={i}
                onClick={() => onEditDay?.(d)}
                className={`${cellCls(d)} hover:bg-slate-50`}
                style={{ width: CELL_W }}
              >
                {inner}
              </button>
            );
          })}
        </div>

        {/* 項目行（内訳・子）: インデント＋小さめ丸チェック */}
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-stretch border-b border-slate-100 last:border-b-0"
          >
            <div
              className="sticky left-0 z-10 flex items-center gap-2 border-r border-card-border bg-card-bg py-2 pl-6 pr-3"
              style={{ width: NAME_W }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: it.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-slate-700">
                  {it.name}
                </span>
                <span className="block text-[12px] text-muted">
                  今週 {weekDoneCount(it.id)}日
                </span>
              </span>
            </div>
            {gridDays.map((d, i) => {
              const done = (minutes[`${it.id}:${ymd(d)}`] ?? 0) > 0;
              const inner = (
                <span
                  className="flex h-5.5 w-5.5 items-center justify-center rounded-full text-[12px] font-bold"
                  style={done ? { backgroundColor: it.color, color: "#fff" } : { boxShadow: "inset 0 0 0 1.5px #d1d9e2", color: "#cbd5e1" }}
                >
                  {done ? "✓" : ""}
                </span>
              );
              return readOnly ? (
                <div key={i} className={cellCls(d)} style={{ width: CELL_W }}>
                  {inner}
                </div>
              ) : (
                <button
                  key={i}
                  onClick={() => onToggle?.(it.id, d)}
                  className={`${cellCls(d)} hover:bg-slate-50`}
                  style={{ width: CELL_W }}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
