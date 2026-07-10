import { useEffect, useState } from "react";
import { getMyProfile, listAllProfiles, type Profile } from "@/lib/profile";

// 設定ページ用の「対象ユーザー」セレクタ（開発者のみ表示）。
// target=null は自分。他ユーザーを選ぶと警告バナーを表示する。
// 開発者以外や未取得のときは何も描画しない（＝常に自分のデータ）。
export function UserScopeSelect({
  target,
  onChange,
}: {
  target: string | null;
  onChange: (id: string | null) => void;
}) {
  const [selfId, setSelfId] = useState<string | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [users, setUsers] = useState<Profile[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await getMyProfile();
      if (!alive) return;
      setSelfId(p?.id ?? null);
      if (p?.role === "developer") {
        setIsDev(true);
        try {
          const list = await listAllProfiles();
          if (alive) setUsers(list);
        } catch {
          /* no-op */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!isDev) return null;

  const label = (u: Profile) =>
    u.nickname?.trim() || u.email?.split("@")[0] || "（名称未設定）";
  const sorted = [...users].sort((a, b) => {
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    return label(a).localeCompare(label(b));
  });
  const value = target ?? selfId ?? "";
  const isOther = target != null && target !== selfId;
  const targetName = label(
    users.find((u) => u.id === target) ?? ({} as Profile),
  );

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">対象ユーザー</span>
        <select
          value={value}
          onChange={(e) => {
            const id = e.target.value === selfId ? null : e.target.value;
            if (id) {
              const nm = label(
                users.find((u) => u.id === id) ?? ({} as Profile),
              );
              if (
                !confirm(
                  `他のメンバー（${nm} さん）の設定を編集します。よろしいですか？`,
                )
              )
                return;
            }
            onChange(id);
          }}
          className="rounded-lg border border-slate-300 bg-card-bg px-3 py-1.5 text-[15px] text-slate-900"
        >
          {sorted.map((u) => (
            <option key={u.id} value={u.id}>
              {label(u)}
              {u.id === selfId ? "（自分）" : ""}
            </option>
          ))}
        </select>
      </div>
      {isOther && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] font-medium text-amber-800">
          <svg
            className="h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          他のメンバー（{targetName} さん）の設定を編集しています。
        </div>
      )}
    </div>
  );
}
