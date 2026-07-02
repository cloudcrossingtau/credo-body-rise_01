import type { UserGrid } from "./devData";

// CSV フィールドのエスケープ（カンマ・ダブルクオート・改行を含む場合は "" で囲む）。
function esc(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// 全ユーザーの記録を縦持ち CSV にする。
// 列: メール / ニックネーム / 日付 / 項目 / 値
//   - 各日の合計時間 …「トレーニング時間(分)」＋分
//   - 各項目の実施 …「(項目名)」＋実施
// 並び: メール → 日付 → 項目（時間は各日の先頭）
export function recordsToCsv(users: UserGrid[]): string {
  const header = ["メール", "ニックネーム", "日付", "項目", "値"];
  const rows: string[][] = [];
  for (const u of users) {
    const email = u.email ?? "";
    const nick = u.nickname ?? "";
    // 日別トレーニング時間
    for (const [date, minutes] of Object.entries(u.dayMinutes)) {
      // sortKey 用に項目名を空文字にして各日の先頭へ
      rows.push([email, nick, date, "トレーニング時間(分)", String(minutes), ""]);
    }
    // 項目の実施マーク
    const itemById = new Map(u.items.map((it) => [it.id, it]));
    for (const key of Object.keys(u.minutes)) {
      const sep = key.indexOf(":");
      const itemId = key.slice(0, sep);
      const date = key.slice(sep + 1);
      const it = itemById.get(itemId);
      if (!it) continue; // 項目が削除済みの記録はスキップ
      rows.push([email, nick, date, it.name, "実施", it.name]);
    }
  }
  // メール → 日付 → (時間行が先) → 項目名
  rows.sort(
    (a, b) =>
      a[0].localeCompare(b[0]) ||
      a[2].localeCompare(b[2]) ||
      a[5].localeCompare(b[5]),
  );
  // 並び替え用の6列目を落として出力
  return [header, ...rows.map((r) => r.slice(0, 5))]
    .map((cols) => cols.map(esc).join(","))
    .join("\r\n");
}

// CSV 文字列をファイルとしてダウンロードさせる。
// Excel で日本語が化けないよう UTF-8 BOM を付ける。
export function downloadCsv(filename: string, csv: string): void {
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
