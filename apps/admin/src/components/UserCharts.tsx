import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  ymd,
  addDays,
  startOfDay,
  startOfWeek,
  niceScale,
  WD,
  TIME_COLOR,
} from "@/lib/training";

const CHART_H = 200; // 描画領域の高さ(px)
const AXIS_W = 40; // y軸ラベル幅(px)
const DAY_W = 44; // 日別バー幅(px)
const WEEK_W = 64; // 週別バー幅(px)

// グラフ描画部品（データ取得はしない）。日別・週別の合計トレーニング時間（分）を描く。
export function UserCharts({
  dayMinutes,
  weekStart,
}: {
  dayMinutes: Record<string, number>; // date -> 分
  weekStart: number;
}) {
  const timeDailyRef = useRef<HTMLDivElement>(null);
  const timeWeeklyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toEnd = (r: RefObject<HTMLDivElement>) => {
      if (r.current) r.current.scrollLeft = r.current.scrollWidth;
    };
    toEnd(timeDailyRef);
    toEnd(timeWeeklyRef);
  }, [dayMinutes]);

  const today = startOfDay(new Date());
  const recYmds = Object.keys(dayMinutes);
  const firstYmd = recYmds.length
    ? recYmds.reduce((a, b) => (a < b ? a : b))
    : ymd(today);
  const [fy, fm, fd] = firstYmd.split("-").map(Number);
  let dayStart = new Date(fy, fm - 1, fd);
  const minStart = addDays(today, -13);
  if (dayStart.getTime() > minStart.getTime()) dayStart = minStart;
  const dayCount =
    Math.round((today.getTime() - dayStart.getTime()) / 86400000) + 1;
  const dayList = Array.from({ length: dayCount }, (_, i) =>
    addDays(dayStart, i),
  );
  const wFirst = startOfWeek(dayStart, weekStart);
  const wLast = startOfWeek(today, weekStart);
  const weekCount =
    Math.round((wLast.getTime() - wFirst.getTime()) / (7 * 86400000)) + 1;
  const weekList = Array.from({ length: weekCount }, (_, i) =>
    addDays(wFirst, i * 7),
  );

  const sumDay = (d: Date) => dayMinutes[ymd(d)] ?? 0;
  const sumWeek = (ws: Date) => {
    let s = 0;
    for (let k = 0; k < 7; k++) s += sumDay(addDays(ws, k));
    return s;
  };

  const dailyX = (d: Date): ReactNode => {
    const wd = d.getDay();
    const isFirst = d.getDate() === 1;
    return (
      <div className="text-center">
        <div
          className={`text-[12px] ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : "text-muted"}`}
        >
          {isFirst ? `${d.getMonth() + 1}/1` : d.getDate()}
        </div>
        <div className="text-[11px] text-slate-500">{WD[wd]}</div>
      </div>
    );
  };
  const weeklyX = (ws: Date): ReactNode => {
    const we = addDays(ws, 6);
    return (
      <div className="text-center text-[11px] text-muted">
        {ws.getMonth() + 1}/{ws.getDate()}
        <br />〜{we.getMonth() + 1}/{we.getDate()}
      </div>
    );
  };

  const fmt = (v: number) => `${Math.round(v)}`;

  const renderBarChart = (
    cols: { value: number; x: ReactNode }[],
    barW: number,
    scrollRef: RefObject<HTMLDivElement>,
  ) => {
    const scale = niceScale(Math.max(0, ...cols.map((c) => c.value)));
    const ticks: number[] = [];
    for (let t = 0; t <= scale.max + 1e-9; t += scale.step) ticks.push(t);
    return (
      <div className="mt-3 flex items-start rounded-2xl border border-card-border bg-card-bg p-3">
        <div className="relative shrink-0" style={{ width: AXIS_W, height: CHART_H }}>
          {ticks.map((t, i) => (
            <div
              key={i}
              className="absolute right-1 -translate-y-1/2 text-right text-[11px] text-slate-500"
              style={{ top: `${(1 - t / scale.max) * 100}%` }}
            >
              {fmt(t)}
            </div>
          ))}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-x-auto">
          <div style={{ minWidth: cols.length * barW }}>
            <div className="relative" style={{ height: CHART_H }}>
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 -translate-y-1/2 border-t border-slate-100"
                  style={{ top: `${(1 - t / scale.max) * 100}%` }}
                />
              ))}
              <div className="absolute inset-0 flex items-stretch">
                {cols.map((col, i) => (
                  <div
                    key={i}
                    className="flex h-full flex-col items-center justify-end gap-0.5"
                    style={{ width: barW }}
                  >
                    {col.value > 0 && (
                      <span className="text-[11px] font-semibold text-slate-700">
                        {fmt(col.value)}
                      </span>
                    )}
                    <div
                      className="w-full max-w-[2.2rem] rounded-t-md"
                      style={{
                        height: `${(col.value / scale.max) * 100}%`,
                        backgroundColor: TIME_COLOR,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1 flex">
              {cols.map((col, i) => (
                <div key={i} style={{ width: barW }}>
                  {col.x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="mt-2">
        <h3 className="text-[15px] font-semibold text-slate-900">
          トレーニング時間（分）・日別
        </h3>
        {renderBarChart(
          dayList.map((d) => ({ value: sumDay(d), x: dailyX(d) })),
          DAY_W,
          timeDailyRef,
        )}
      </section>
      <section className="mt-5">
        <h3 className="text-[15px] font-semibold text-slate-900">
          トレーニング時間（分）・週別
        </h3>
        {renderBarChart(
          weekList.map((ws) => ({ value: sumWeek(ws), x: weeklyX(ws) })),
          WEEK_W,
          timeWeeklyRef,
        )}
      </section>
    </>
  );
}
