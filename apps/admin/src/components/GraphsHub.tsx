import { useState } from "react";
import { Charts } from "@/components/Charts";
import { ItemAnalysis } from "@/components/ItemAnalysis";
import { ItemTrend } from "@/components/ItemTrend";
import { RefreshButton } from "@/components/RefreshButton";

// グラフのハブ。時間／バランス／推移 を iOSセグメントのサブタブで切り替える
// （モバイルの「グラフ」タブと同じ構成に統一）。各ビューは embedded で自前の
// 見出し・更新ボタンを隠して表示。更新は key を変えて再マウント＝再取得。
type Tab = "time" | "balance" | "trend";

export function GraphsHub({ initialTab = "time" }: { initialTab?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [refreshKey, setRefreshKey] = useState(0);

  const seg = (active: boolean) =>
    `rounded-md px-4 py-1.5 text-[15px] font-medium transition-colors ${
      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
    }`;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          {(
            [
              ["time", "時間"],
              ["balance", "バランス"],
              ["trend", "推移"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={seg(tab === k)}>
              {label}
            </button>
          ))}
        </div>
        <RefreshButton onClick={() => setRefreshKey((n) => n + 1)} />
      </div>

      {tab === "time" && <Charts key={`time-${refreshKey}`} embedded />}
      {tab === "balance" && <ItemAnalysis key={`bal-${refreshKey}`} embedded />}
      {tab === "trend" && <ItemTrend key={`trd-${refreshKey}`} embedded />}
    </div>
  );
}
