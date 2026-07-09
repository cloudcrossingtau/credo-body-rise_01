type Card = { href: string; title: string; description: string; icon: string };
type Section = { title: string; cards: Card[] };

const ICON = {
  profile:
    "M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z",
  items:
    "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
  week: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
  invite:
    "M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z",
  license:
    "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25",
};

// 設定のランディング（nouker と同じカード一覧 → 各詳細ページへ遷移）。
export function SettingsHome() {

  const sections: Section[] = [
    {
      title: "アカウント",
      cards: [
        {
          href: "/settings/profile",
          title: "プロフィール",
          description: "ニックネーム・アバターの設定",
          icon: ICON.profile,
        },
      ],
    },
    {
      title: "トレーニング",
      cards: [
        {
          href: "/settings/categories",
          title: "カテゴリ",
          description: "トレーニング項目のカテゴリ（名前・色）を管理",
          icon: ICON.items,
        },
        {
          href: "/settings/items",
          title: "トレーニング項目",
          description: "項目の追加・編集・並べ替え・削除",
          icon: ICON.items,
        },
        {
          href: "/settings/week-start",
          title: "週の開始曜日",
          description: "グラフ・週合計の集計の起点",
          icon: ICON.week,
        },
      ],
    },
    // ユーザー招待は「管理」タブへ移設（設定からは除外）
    {
      title: "情報",
      cards: [
        {
          href: "/settings/licenses",
          title: "オープンソースライセンス",
          description: "本アプリが使用する OSS の一覧",
          icon: ICON.license,
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-6 text-[20px] font-semibold text-foreground">設定</h2>
      {sections.map((sec) => (
        <section key={sec.title} className="mb-8">
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">
            {sec.title}
          </h3>
          <div className="space-y-2">
            {sec.cards.map((c) => (
              <a
                key={c.href}
                href={c.href}
                className="flex items-center gap-4 rounded-xl border border-card-border bg-card-bg p-4 transition-all hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-light text-accent">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d={c.icon}
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-foreground">
                    {c.title}
                  </p>
                  <p className="text-[13px] text-muted">{c.description}</p>
                </div>
                <svg
                  className="h-5 w-5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </a>
            ))}
          </div>
        </section>
      ))}

      {/* バージョン表示（不具合報告時・動作版の確認用） */}
      <p className="mt-4 text-center text-[12px] text-muted">
        CredoBodyRise 管理 v{import.meta.env.PUBLIC_BUILD_VERSION} (
        {import.meta.env.PUBLIC_BUILD_COMMIT} ·{" "}
        {new Date(import.meta.env.PUBLIC_BUILD_TIME).toLocaleString("ja-JP", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
        )
      </p>
    </div>
  );
}
