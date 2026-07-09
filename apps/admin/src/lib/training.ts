// トレーニング記録の共有ロジック（型・日付ユーティリティ・目盛り・デモ生成）。
// 記録/グラフ/設定の各ページから参照する。mobile-web の HabitCalendar 内の
// 同等ロジックを admin（デスクトップ）向けに切り出したもの。

export type Unit = "time" | "count"; // time=実施時間(分) / count=種目数(回)
// color/categoryName はカテゴリ由来（読み込み時に解決）。categoryId=未分類なら null。
export type Item = {
  id: string;
  name: string;
  color: string;
  unit: Unit;
  categoryId: string | null;
  categoryName: string;
};
// key = `${itemId}:${YYYY-MM-DD}` -> 値（time: 分 / count: 回）
export type Minutes = Record<string, number>;

// ---- 日付ユーティリティ ----
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function startOfWeek(d: Date, weekStart: number): Date {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
}
export const WD = ["日", "月", "火", "水", "木", "金", "土"];

// 数値の見やすい目盛り
export function niceScale(maxVal: number): { max: number; step: number } {
  if (maxVal <= 0) return { max: 1, step: 1 };
  const rough = maxVal / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const cand = [1, 2, 2.5, 5, 10].map((c) => c * pow);
  const step = cand.find((c) => c >= rough) ?? 10 * pow;
  return { max: Math.ceil(maxVal / step) * step, step };
}

export const COLOR_CHOICES = [
  "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6",
];

// グラフ色（単色）
export const TIME_COLOR = "#2563eb"; // 時間（分）= 青
export const COUNT_COLOR = "#10b981"; // 種目数（回）= 緑

// グリッドで遡れる日数（最大スクロール範囲）
export const GRID_PAST_DAYS = 180;
export const QUICK_TIME = [15, 30, 45, 60, 90, 120, 150, 180, 210, 240];
export const QUICK_COUNT = [1, 2, 3, 4, 5];
