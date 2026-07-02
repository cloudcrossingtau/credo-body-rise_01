import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getMyProfile, getAvatarUrl } from "@/lib/profile";
import {
  pullRemote,
  saveRecord,
  deleteRecord,
  saveDayMinutes,
  saveItems,
  saveWeekStart,
  uuid,
} from "@/lib/sync";
import { withRetry, autoReloadOnce } from "@/lib/recover";
import AuthScreen from "./AuthScreen";
import SetPasswordScreen from "./SetPasswordScreen";
import ProfileScreen from "./ProfileScreen";
import { AnnouncementBellButton } from "./AnnouncementBellButton";

// ---- 型 ----
type Unit = "time" | "count"; // time=実施時間(分) / count=種目数(回)
type Item = { id: string; name: string; color: string; unit: Unit };
// key = `${itemId}:${YYYY-MM-DD}` -> 値（time: 分 / count: 回）
type Minutes = Record<string, number>;

// ---- 日付ユーティリティ ----
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
const WD = ["日", "月", "火", "水", "木", "金", "土"];

// 数値の見やすい目盛り
function niceScale(maxVal: number) {
  if (maxVal <= 0) return { max: 1, step: 1 };
  const rough = maxVal / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const cand = [1, 2, 2.5, 5, 10].map((c) => c * pow);
  const step = cand.find((c) => c >= rough) ?? 10 * pow;
  return { max: Math.ceil(maxVal / step) * step, step };
}

const COLOR_CHOICES = [
  "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6",
];
const QUICK_TIME = [15, 30, 45, 60, 90];
const QUICK_COUNT = [1, 2, 3, 4, 5];

// グラフ色（色分けはしない＝グループごとに単色）
const TIME_COLOR = "#3b82f6";
const COUNT_COLOR = "#10b981";

const CHART_H = 160; // グラフ描画領域の高さ(px)
const AXIS_W = 32; // y軸ラベル幅(px)
const DAY_W = 44; // 日別バー1本ぶんの幅(px)
const WEEK_W = 64; // 週別バー1本ぶんの幅(px)
const GRID_PAST_DAYS = 180; // 記録グリッドで遡れる日数（最大スクロール範囲）
// 引っ張って更新: 表の横スクロールと干渉するため現在は無効。再取得はログイン時に行う。
const ENABLE_PULL_TO_REFRESH = false;
const NAME_W = 88; // 種目名カラム幅(px)
const CELL_W = 44; // 記録グリッドの1日セル幅(px)

export default function TrainingLog() {
  const [items, setItems] = useState<Item[]>([]);
  const [minutes, setMinutes] = useState<Minutes>({}); // 項目の実施マーク（1=実施）
  const [dayMinutes, setDayMinutes] = useState<Record<string, number>>({}); // 日別合計時間(分)
  const [weekStart, setWeekStart] = useState<number>(1); // 0=日..6=土（既定=月）
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<
    "grid" | "settings" | "charts" | "profile"
  >("grid");

  // 認証（Supabase 設定時のみ有効。未設定ならローカルのみで動作）
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  // 起動時の読み込み（Supabaseが正本）。失敗したら再読み込みを促す。
  const [loadError, setLoadError] = useState<string | null>(null);
  // 引っ張って更新
  const [refreshing, setRefreshing] = useState(false);
  const [pullDist, setPullDist] = useState(0);
  const refreshingRef = useRef(false);
  const pullRef = useRef({ active: false, startY: 0, dist: 0 });
  // セル保存・設定保存・データ操作の進行/失敗表示
  const [cellBusy, setCellBusy] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // 招待メール/再設定リンク経由＝初回パスワード設定が必要
  const [needsPassword, setNeedsPassword] = useState(false);
  // 招待フォーム
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  // 日別トレーニング時間の編集モーダル（対象日）
  const [editing, setEditing] = useState<Date | null>(null);
  const [editVal, setEditVal] = useState("");

  // 設定: 項目ごとのインライン色ピッカー
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  // 設定: 新規追加フォーム
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_CHOICES[0]);
  const [newUnit, setNewUnit] = useState<Unit>("time");
  // 設定: 参照/編集モード（編集前の状態をスナップショットして キャンセルで復元）
  const [settingsEditing, setSettingsEditing] = useState(false);
  // 設定タブ内のサブ画面（メニュー → 各設定へ1段深く入る）
  const [settingsPane, setSettingsPane] = useState<
    "menu" | "week" | "items" | "invite" | "profile"
  >("menu");
  const [settingsSnapshot, setSettingsSnapshot] = useState<{
    items: Item[];
    minutes: Minutes;
    weekStart: number;
  } | null>(null);

  // 横スクロール用ref（開いたら右端=最新へ）
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const timeDailyRef = useRef<HTMLDivElement>(null);
  const timeWeeklyRef = useRef<HTMLDivElement>(null);
  const countDailyRef = useRef<HTMLDivElement>(null);
  const countWeeklyRef = useRef<HTMLDivElement>(null);

  // 認証セッションの監視
  useEffect(() => {
    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    // 招待/パスワード再設定リンク経由かどうか（URLハッシュで判定）
    if (
      typeof window !== "undefined" &&
      /type=(invite|recovery)/.test(window.location.hash)
    ) {
      setNeedsPassword(true);
    }
    // ハング検知ウォッチドッグ: getSession がスリープ復帰後などに無言で固まると
    // 「読み込み中」のままになるため、一定時間で返らなければ一度だけ自動リロード。
    const RELOAD_FLAG = "cbr-auth-recovered";
    let authSettled = false;
    const watchdog = window.setTimeout(() => {
      if (authSettled) return;
      if (sessionStorage.getItem(RELOAD_FLAG)) return; // 1回だけ（ループ防止）
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    }, 7000);
    supabase.auth.getSession().then(({ data }) => {
      authSettled = true;
      window.clearTimeout(watchdog);
      sessionStorage.removeItem(RELOAD_FLAG);
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setNeedsPassword(true);
      // ログアウト/ログイン時はホームに戻す（前回のビューが残らないように）
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") setView("grid");
      // ログアウト時は画面の状態をクリアするだけ（データはSupabaseにあるので消えない）。
      // 再ログイン時に session が変わり、再度Supabaseから読み込まれる。
      if (event === "SIGNED_OUT") {
        setItems([]);
        setMinutes({});
        setDayMinutes({});
        setLoaded(false);
        setLoadError(null);
      }
    });
    return () => {
      window.clearTimeout(watchdog);
      sub.subscription.unsubscribe();
    };
  }, []);

  // ログイン中ユーザーのプロフィール（role / アバター）を取得
  function refreshProfile() {
    getMyProfile().then((p) => {
      setMyRole(p?.role ?? null);
      setMyAvatarUrl(getAvatarUrl(p?.avatar_path ?? null));
    });
  }
  useEffect(() => {
    if (!supabase || !session) {
      setMyRole(null);
      setMyAvatarUrl(null);
      return;
    }
    refreshProfile();
  }, [session]);

  // ---- 起動時の読み込み（Supabase が正本）----
  async function loadData() {
    if (!supabase || !session) return;
    setLoaded(false);
    setLoadError(null);
    try {
      const remote = await withRetry(() => pullRemote(), {
        timeoutMs: 5000,
        maxAttempts: 3,
        label: "pullRemote",
      });
      if (remote) {
        setItems(remote.items);
        setMinutes(remote.minutes);
        setDayMinutes(remote.dayMinutes);
        if (remote.weekStart != null) setWeekStart(remote.weekStart);
      }
      setLoaded(true);
    } catch (e) {
      console.warn("[load] failed:", e);
      // ハングが疑われる時は自動リロードで復帰（ループはクールダウンで防止）。
      if (!autoReloadOnce()) {
        setLoadError("データの読み込みに失敗しました。通信状況を確認してください。");
      }
    }
  }
  // 再読み込みは「ユーザーが変わったとき（ログイン/ログアウト/別ユーザー）」だけにする。
  // session オブジェクトはトークン自動更新のたびに差し替わるため、それを依存にすると
  // 利用中に loadData が再実行され、編集（削除など）が裏の再取得で上書きされてしまう。
  const sessionUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (!supabase) {
      // バックエンド未設定（開発時など）：永続化なしのメモリ動作
      setLoaded(true);
      return;
    }
    if (!sessionUserId) {
      setLoaded(false);
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  // ---- 引っ張って更新（ホーム画面）----
  // loadData と違い loaded を false にしない（全画面ローディングに切り替えず、その場で再取得）。
  async function refreshData() {
    if (!supabase || !session || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const remote = await pullRemote();
      if (remote) {
        setItems(remote.items);
        setMinutes(remote.minutes);
        setDayMinutes(remote.dayMinutes);
        if (remote.weekStart != null) setWeekStart(remote.weekStart);
      }
    } catch (e) {
      console.warn("[refresh] failed:", e);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  // ホーム表示中のみ、ページ最上部からの下方向ドラッグで再取得する。
  // iOS で React 合成イベントを取りこぼすことがあるため native リスナで登録。
  // ※ 表の横スクロールと干渉するため現在は無効化（ENABLE_PULL_TO_REFRESH=false）。
  useEffect(() => {
    if (!ENABLE_PULL_TO_REFRESH) return;
    if (view !== "grid" || !supabase || !session || !loaded) return;
    const THRESHOLD = 70; // この距離を超えて離すと更新
    // 表(グリッド)が自身の最上部にある時だけ pull を許可。少しでもスクロールされていれば
    // 下方向ドラッグはグリッドのスクロールに任せ、更新は発火しない（干渉を防ぐ）。
    const atTop = () => {
      if (window.scrollY > 0) return false;
      const g = gridScrollRef.current;
      if (g && g.scrollTop > 0) return false;
      return true;
    };
    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || !atTop()) {
        pullRef.current.active = false;
        return;
      }
      pullRef.current.active = true;
      pullRef.current.startY = e.touches[0].clientY;
      pullRef.current.dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!pullRef.current.active || refreshingRef.current) return;
      const dy = e.touches[0].clientY - pullRef.current.startY;
      // 下方向以外、またはグリッドがスクロールされた瞬間に中止（グリッド側のスクロール優先）
      if (dy <= 0 || !atTop()) {
        pullRef.current.dist = 0;
        setPullDist(0);
        return;
      }
      const d = Math.min(dy * 0.5, 90); // 抵抗をつけて最大90px
      pullRef.current.dist = d;
      setPullDist(d);
    };
    const onEnd = () => {
      if (!pullRef.current.active) return;
      pullRef.current.active = false;
      const reached = pullRef.current.dist >= THRESHOLD;
      pullRef.current.dist = 0;
      setPullDist(0);
      if (reached) refreshData();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session, loaded]);

  async function invite() {
    if (!supabase) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    setInviteMsg(null);
    try {
      const { error } = await supabase.functions.invoke("invite-user", {
        body: { email, redirectTo: window.location.origin },
      });
      if (error) {
        // Edge Function が返した本当のエラー本文を取り出す
        let detail = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const b = await ctx.json();
            if (b?.error) detail = b.error;
          } catch {
            /* 本文がJSONでない場合は message のまま */
          }
        }
        throw new Error(detail);
      }
      setInviteMsg(`${email} に招待メールを送信しました。`);
      setInviteEmail("");
    } catch (e) {
      setInviteMsg(
        "招待に失敗しました：" +
          (e instanceof Error ? e.message : "不明なエラー"),
      );
    } finally {
      setInviteBusy(false);
    }
  }

  // 各画面を開いたら右端（最新）へスクロール
  useEffect(() => {
    const toEnd = (r: RefObject<HTMLDivElement>) => {
      if (r.current) r.current.scrollLeft = r.current.scrollWidth;
    };
    if (view === "charts") {
      toEnd(timeDailyRef);
      toEnd(timeWeeklyRef);
      toEnd(countDailyRef);
      toEnd(countWeeklyRef);
    }
    if (view === "grid") toEnd(gridScrollRef);
  }, [view, weekStart, loaded, session, authChecked]);

  // 設定タブから離れたら参照モードに戻す
  useEffect(() => {
    if (view !== "settings") {
      setSettingsEditing(false);
      setSettingsSnapshot(null);
      setSettingsPane("menu");
    }
  }, [view]);

  const todayStr = ymd(new Date());

  // ---- 項目の実施/未実施をトグル（即時保存）----
  async function toggleItem(itemId: string, d: Date) {
    const date = ymd(d);
    const key = `${itemId}:${date}`;
    const done = (minutes[`${itemId}:${date}`] ?? 0) > 0;
    try {
      if (supabase) {
        if (done) await deleteRecord(itemId, date);
        else await saveRecord(itemId, date, 1);
      }
      setMinutes((prev) => {
        const next = { ...prev };
        if (done) delete next[key];
        else next[key] = 1;
        return next;
      });
    } catch (e) {
      console.warn("[record] toggle failed:", e);
      alert("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    }
  }

  // ---- 日別トレーニング時間の入力 ----
  function openEditor(d: Date) {
    const cur = dayMinutes[ymd(d)] ?? 0;
    setEditing(d);
    setEditVal(cur ? String(cur) : "");
    setCellError(null);
  }
  async function applyEditor() {
    if (!editing) return;
    const date = ymd(editing);
    const v = Math.max(0, Math.round(Number(editVal) || 0));
    setCellBusy(true);
    setCellError(null);
    try {
      if (supabase) await saveDayMinutes(date, v);
      setDayMinutes((prev) => {
        const next = { ...prev };
        if (v > 0) next[date] = v;
        else delete next[date];
        return next;
      });
      setEditing(null);
    } catch (e) {
      console.warn("[record] day save failed:", e);
      setCellError("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setCellBusy(false);
    }
  }

  // 今週（週開始曜日基準）の合計トレーニング時間（分）
  function weekMinutes() {
    const ws = startOfWeek(startOfDay(new Date()), weekStart);
    let m = 0;
    for (let k = 0; k < 7; k++) m += dayMinutes[ymd(addDays(ws, k))] ?? 0;
    return m;
  }
  // 今週の実施日数（項目ごと）
  function weekDoneCount(itemId: string) {
    const ws = startOfWeek(startOfDay(new Date()), weekStart);
    let c = 0;
    for (let k = 0; k < 7; k++) {
      if ((minutes[`${itemId}:${ymd(addDays(ws, k))}`] ?? 0) > 0) c++;
    }
    return c;
  }

  // ---- 設定: 項目の編集 ----
  function updateItem(id: string, patch: Partial<Item>) {
    setItems((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function moveItem(id: string, dir: -1 | 1) {
    setItems((arr) => {
      const i = arr.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function deleteItem(id: string) {
    const it = items.find((x) => x.id === id);
    if (it && !confirm(`「${it.name}」を削除しますか？記録も削除されます。`)) return;
    setItems((arr) => arr.filter((x) => x.id !== id));
    setMinutes((m) => {
      const next: Minutes = {};
      for (const k of Object.keys(m)) {
        if (!k.startsWith(`${id}:`)) next[k] = m[k];
      }
      return next;
    });
  }
  function addItem() {
    const name = newName.trim();
    if (!name) return;
    const id = uuid();
    setItems((arr) => [...arr, { id, name, color: newColor, unit: newUnit }]);
    setNewName("");
    setNewColor(COLOR_CHOICES[0]);
    setNewUnit("time");
  }
  function enterSettingsEdit() {
    setSettingsSnapshot({ items, minutes, weekStart });
    setSettingsEditing(true);
    setColorPickerFor(null);
    setSettingsError(null);
  }
  // 「保存」: 編集中の項目・週開始曜日を Supabase に反映。失敗したら編集を維持。
  async function saveSettingsEdit() {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      if (supabase) {
        await saveItems(items);
        await saveWeekStart(weekStart);
      }
      setSettingsSnapshot(null);
      setSettingsEditing(false);
      setColorPickerFor(null);
      setSettingsPane("menu"); // 保存できたら設定メニューに戻る
    } catch (e) {
      console.warn("[settings] save failed:", e);
      setSettingsError("保存に失敗しました。通信状況を確認してもう一度お試しください。");
    } finally {
      setSettingsSaving(false);
    }
  }
  // 「キャンセル」: 編集を破棄（編集中はDBに書いていないのでローカルを戻すだけ）。
  function cancelSettingsEdit() {
    if (settingsSnapshot) {
      setItems(settingsSnapshot.items);
      setMinutes(settingsSnapshot.minutes);
      setWeekStart(settingsSnapshot.weekStart);
    }
    setSettingsSnapshot(null);
    setSettingsEditing(false);
    setColorPickerFor(null);
    setSettingsError(null);
    setSettingsPane("menu"); // キャンセル/戻るで設定メニューに戻る
  }


  // ---- 下部タブバー ----
  const TABS: { id: "grid" | "charts" | "settings"; label: string; icon: ReactNode }[] = [
    {
      id: "grid",
      label: "ホーム",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z" />
        </svg>
      ),
    },
    {
      id: "charts",
      label: "グラフ",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M3 3v18h18" />
          <path d="M8 17v-4" />
          <path d="M13 17v-8" />
          <path d="M18 17v-6" />
        </svg>
      ),
    },
    {
      id: "settings",
      label: "設定",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      ),
    },
  ];
  const tabBar = (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-card-bg dark:border-slate-800 dark:bg-slate-900"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="主要ナビゲーション"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => {
          const active = view === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 ${
                active ? "text-accent" : "text-slate-500 dark:text-slate-400"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {t.icon}
              <span className="text-[12px] font-medium leading-none">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  // ===================== 認証ゲート =====================
  // Supabase 設定時のみ。未ログインならログイン画面、招待リンク経由ならパスワード設定。
  if (supabase) {
    if (!authChecked) {
      return (
        <div className="py-24 text-center text-[15px] text-muted">
          読み込み中…
        </div>
      );
    }
    if (session && needsPassword) {
      return (
        <SetPasswordScreen
          onDone={() => {
            setNeedsPassword(false);
            if (typeof window !== "undefined") {
              history.replaceState(null, "", window.location.pathname);
            }
          }}
        />
      );
    }
    if (!session) {
      return <AuthScreen />;
    }
    // データ読み込み中／失敗（Supabaseが正本）
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
        <div className="py-24 text-center text-[15px] text-muted">
          読み込み中…
        </div>
      );
    }
  }

  // ===================== プロフィールビュー =====================
  if (view === "profile") {
    return (
      <>
        <ProfileScreen
          onBack={() => setView("grid")}
          onChanged={refreshProfile}
        />
        {tabBar}
      </>
    );
  }

  // ===================== 設定ビュー =====================
  if (view === "settings") {
    // プロフィールは独立画面（ProfileScreen）を設定サブ画面として表示。戻るで設定メニューへ。
    if (settingsPane === "profile") {
      return (
        <>
          <ProfileScreen
            onBack={() => setSettingsPane("menu")}
            onChanged={refreshProfile}
          />
          {tabBar}
        </>
      );
    }
    const paneTitle =
      settingsPane === "week"
        ? "週の開始曜日"
        : settingsPane === "items"
          ? "トレーニング項目"
          : settingsPane === "invite"
            ? "ユーザー招待"
            : "設定";
    // 設定メニューのカード共通スタイルと右端シェブロン
    const cardCls =
      "flex w-full items-center justify-between rounded-xl border border-card-border bg-card-bg px-4 py-3 text-[15px] text-foreground active:bg-gray-50";
    const chevron = (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-4 w-4 text-slate-400"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    );
    return (
      <>
        <div className="pb-24">
          <header
            className="sticky top-0 z-30 -mx-4 mb-3 border-b border-card-border bg-background px-4"
            style={{ paddingTop: "var(--safe-top)" }}
          >
            <div className="flex h-14 items-center gap-2">
              {settingsPane !== "menu" && (
                <button
                  onClick={cancelSettingsEdit}
                  aria-label="戻る"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:bg-gray-100"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              )}
              <span className="text-[17px] font-semibold text-foreground">
                {paneTitle}
              </span>
            </div>
          </header>

          {settingsPane === "week" ? (
          <>
          {/* 週の開始曜日 */}
          <section className="mt-5">
            <h2 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
              週の開始曜日
            </h2>
            <div className="mt-2 flex gap-1.5">
              {WD.map((w, idx) => (
                <button
                  key={idx}
                  onClick={() => setWeekStart(idx)}
                  className={`flex h-10 flex-1 items-center justify-center rounded-lg text-[15px] font-semibold ${
                    weekStart === idx
                      ? "bg-accent text-white"
                      : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </section>

          {/* 保存 / キャンセル（週の開始曜日） */}
          {settingsError && (
            <p className="mt-5 text-[14px] font-medium text-red-600 dark:text-red-400">
              {settingsError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={saveSettingsEdit}
              disabled={settingsSaving}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {settingsSaving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={cancelSettingsEdit}
              disabled={settingsSaving}
              className="flex-1 rounded-xl border border-slate-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-foreground disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
          </>
          ) : settingsPane === "items" ? (
          <>
          {/* トレーニング項目 */}
          <section className="mt-3">
            <h2 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
              トレーニング項目
            </h2>
            <div className="mt-2 overflow-hidden rounded-2xl border border-card-border bg-card-bg dark:border-slate-800 dark:bg-slate-900">
              {items.map((it, idx) => (
                <div
                  key={it.id}
                  className="border-b border-slate-100 px-2 py-2 last:border-b-0 dark:border-slate-800"
                >
                  <div className="flex items-center gap-2">
                    {/* 並べ替え */}
                    <div className="flex flex-col">
                      <button
                        onClick={() => moveItem(it.id, -1)}
                        disabled={idx === 0}
                        className="px-1 text-[14px] leading-tight text-slate-600 disabled:opacity-30 dark:text-slate-300"
                        aria-label="上へ"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveItem(it.id, 1)}
                        disabled={idx === items.length - 1}
                        className="px-1 text-[14px] leading-tight text-slate-600 disabled:opacity-30 dark:text-slate-300"
                        aria-label="下へ"
                      >
                        ▼
                      </button>
                    </div>
                    {/* 色 */}
                    <button
                      onClick={() =>
                        setColorPickerFor((p) => (p === it.id ? null : it.id))
                      }
                      className="h-8 w-8 shrink-0 rounded-full ring-1 ring-slate-300 dark:ring-slate-600"
                      style={{ backgroundColor: it.color }}
                      aria-label="色を変更"
                    />
                    {/* 名前 */}
                    <input
                      value={it.name}
                      onChange={(e) => updateItem(it.id, { name: e.target.value })}
                      placeholder="項目名"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-card-bg px-2.5 py-2 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                    {/* 削除 */}
                    <button
                      onClick={() => deleteItem(it.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-[15px] font-semibold text-white"
                      aria-label="削除"
                    >
                      ×
                    </button>
                  </div>

                  {/* インライン色ピッカー */}
                  {colorPickerFor === it.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {COLOR_CHOICES.map((c) => (
                        <button
                          key={c}
                          onClick={() => {
                            updateItem(it.id, { color: c });
                            setColorPickerFor(null);
                          }}
                          className={`h-8 w-8 rounded-full ${
                            it.color === c
                              ? "ring-2 ring-slate-500 ring-offset-2 dark:ring-offset-slate-900"
                              : ""
                          }`}
                          style={{ backgroundColor: c }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {items.length === 0 && (
                <p className="px-4 py-6 text-center text-[15px] text-slate-700 dark:text-slate-300">
                  項目がありません。下から追加してください。
                </p>
              )}
            </div>

            {/* 新規追加 */}
            <div className="mt-4 rounded-2xl border border-card-border bg-card-bg p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                項目を追加
              </p>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="項目名（例：水泳）"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-card-bg px-3 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <p className="mt-3 text-[15px] font-medium text-slate-800 dark:text-slate-200">
                色
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {COLOR_CHOICES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`h-8 w-8 rounded-full ${
                      newColor === c
                        ? "ring-2 ring-slate-500 ring-offset-2 dark:ring-offset-slate-900"
                        : ""
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
              <button
                onClick={addItem}
                className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90"
              >
                ＋ 追加
              </button>
            </div>
          </section>

          {/* 保存 / キャンセル */}
          {settingsError && (
            <p className="mt-5 text-[14px] font-medium text-red-600 dark:text-red-400">
              {settingsError}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveSettingsEdit}
              disabled={settingsSaving}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {settingsSaving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={cancelSettingsEdit}
              disabled={settingsSaving}
              className="flex-1 rounded-xl border border-slate-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-foreground disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
          </>
          ) : settingsPane === "invite" ? (
          <>
          {/* ユーザー招待（管理者/開発者のみ） */}
          {supabase && session && (myRole === "admin" || myRole === "developer") ? (
            <section className="mt-3">
              <div className="flex gap-2">
                <input
                  type="email"
                  inputMode="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="招待するメールアドレス"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-card-bg px-3 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  onClick={invite}
                  disabled={inviteBusy}
                  className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-[15px] font-semibold text-white active:opacity-90 disabled:opacity-50"
                >
                  {inviteBusy ? "送信中…" : "招待"}
                </button>
              </div>
              {inviteMsg && (
                <p className="mt-2 text-[14px] text-slate-700 dark:text-slate-300">
                  {inviteMsg}
                </p>
              )}
            </section>
          ) : (
            <p className="mt-3 text-[15px] text-muted">
              この操作には管理者権限が必要です。
            </p>
          )}
          </>
          ) : (
          <>
          {/* 設定メニュー（カテゴリ別・各設定へ1段深く入る） */}
          <div className="mt-3 space-y-6">
            {/* アカウント */}
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                アカウント
              </h3>
              <div className="space-y-2">
                <button onClick={() => setSettingsPane("profile")} className={cardCls}>
                  <span>プロフィール</span>
                  {chevron}
                </button>
              </div>
            </section>

            {/* トレーニング */}
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                トレーニング
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setSettingsPane("items");
                    enterSettingsEdit();
                  }}
                  className={cardCls}
                >
                  <span>トレーニング項目</span>
                  {chevron}
                </button>
                <button
                  onClick={() => {
                    setSettingsPane("week");
                    enterSettingsEdit();
                  }}
                  className={cardCls}
                >
                  <span>週の開始曜日</span>
                  {chevron}
                </button>
              </div>
            </section>

            {/* 管理（管理者/開発者のみ） */}
            {supabase && session && (myRole === "admin" || myRole === "developer") && (
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                  管理
                </h3>
                <div className="space-y-2">
                  <button onClick={() => setSettingsPane("invite")} className={cardCls}>
                    <span>ユーザー招待</span>
                    {chevron}
                  </button>
                </div>
              </section>
            )}

            {/* 情報 */}
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                情報
              </h3>
              <div className="space-y-2">
                <a href="/licenses" className={cardCls}>
                  <span>オープンソースライセンス</span>
                  {chevron}
                </a>
              </div>
            </section>
          </div>

          {/* バージョン表示（不具合報告時・動作版の確認用） */}
          <p className="mt-8 pb-2 text-center text-[12px] text-muted">
            CredoBodyRise v{import.meta.env.PUBLIC_BUILD_VERSION} (
            {import.meta.env.PUBLIC_BUILD_COMMIT} ·{" "}
            {new Date(import.meta.env.PUBLIC_BUILD_TIME).toLocaleString("ja-JP", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            )
          </p>
          </>
          )}
        </div>
        {tabBar}
      </>
    );
  }

  // ===================== グラフビュー =====================
  if (view === "charts") {
    const today = startOfDay(new Date());
    // 表示範囲：最古の記録日（最低14日）〜今日
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
            className={`text-[12px] ${
              wd === 0
                ? "text-red-500"
                : wd === 6
                  ? "text-blue-500"
                  : "text-muted"
            }`}
          >
            {isFirst ? `${d.getMonth() + 1}/1` : d.getDate()}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-500">
            {WD[wd]}
          </div>
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

    // 分は整数。軸目盛りが端数になっても見やすいよう四捨五入して表示。
    const fmtMin = (v: number) => `${Math.round(v)}`;
    const fmtC = (v: number) => `${v}`;

    // 単色の棒グラフ（色分けなし）
    const renderBarChart = (
      cols: { value: number; x: ReactNode }[],
      color: string,
      fmt: (v: number) => string,
      barW: number,
      scrollRef: RefObject<HTMLDivElement>,
    ) => {
      const scale = niceScale(Math.max(0, ...cols.map((c) => c.value)));
      const ticks: number[] = [];
      for (let t = 0; t <= scale.max + 1e-9; t += scale.step) ticks.push(t);
      return (
        <div className="mt-3 flex items-start rounded-2xl border border-card-border bg-card-bg p-3 dark:border-slate-800 dark:bg-slate-900">
          {/* 固定Y軸 */}
          <div className="relative shrink-0" style={{ width: AXIS_W, height: CHART_H }}>
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute right-1 -translate-y-1/2 text-right text-[11px] text-slate-500 dark:text-slate-400"
                style={{ top: `${(1 - t / scale.max) * 100}%` }}
              >
                {fmt(t)}
              </div>
            ))}
          </div>
          {/* スクロールするバー領域 */}
          <div ref={scrollRef} className="flex-1 overflow-x-auto">
            <div style={{ minWidth: cols.length * barW }}>
              <div className="relative" style={{ height: CHART_H }}>
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 -translate-y-1/2 border-t border-slate-100 dark:border-slate-800"
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
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          {fmt(col.value)}
                        </span>
                      )}
                      <div
                        className="w-full max-w-[2.2rem] rounded-t-md"
                        style={{
                          height: `${(col.value / scale.max) * 100}%`,
                          backgroundColor: color,
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
        <div className="pb-24">
          <header
            className="sticky top-0 z-30 -mx-4 mb-3 border-b border-card-border bg-background px-4"
            style={{ paddingTop: "var(--safe-top)" }}
          >
            <div className="flex h-14 items-center">
              <span className="text-[17px] font-semibold text-foreground">
                グラフ
              </span>
            </div>
          </header>

          <section className="mt-5">
            <h2 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
              トレーニング時間（分）・日別
            </h2>
            {renderBarChart(
              dayList.map((d) => ({ value: sumDay(d), x: dailyX(d) })),
              TIME_COLOR,
              fmtMin,
              DAY_W,
              timeDailyRef,
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
              トレーニング時間（分）・週別
            </h2>
            {renderBarChart(
              weekList.map((ws) => ({ value: sumWeek(ws), x: weeklyX(ws) })),
              TIME_COLOR,
              fmtMin,
              WEEK_W,
              timeWeeklyRef,
            )}
          </section>
        </div>
        {tabBar}
      </>
    );
  }

  // ===================== 記録（グリッド）ビュー =====================
  // 表示範囲：最古の記録日（最大 GRID_PAST_DAYS 日前）〜 今日
  const gToday = startOfDay(new Date());
  const gRecYmds = Object.keys(minutes).map((k) => k.slice(k.indexOf(":") + 1));
  const gFirstYmd = gRecYmds.length
    ? gRecYmds.reduce((a, b) => (a < b ? a : b))
    : ymd(gToday);
  const [gfy, gfm, gfd] = gFirstYmd.split("-").map(Number);
  let gStart = new Date(gfy, gfm - 1, gfd);
  const gMinStart = addDays(gToday, -GRID_PAST_DAYS);
  if (gStart.getTime() > gMinStart.getTime()) gStart = gMinStart;
  const gCount =
    Math.round((gToday.getTime() - gStart.getTime()) / 86400000) + 1;
  const gridDays = Array.from({ length: gCount }, (_, i) => addDays(gStart, i));

  // 連続する同月の列をまとめた「月バンド」用セグメント（カレンダー風の月見出し）。
  // どの月でも年が分かるよう「YYYY年M月」を表示する。
  const monthSegments: { key: string; label: string; count: number }[] = [];
  for (const d of gridDays) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const key = `${y}-${m}`;
    const last = monthSegments[monthSegments.length - 1];
    if (last && last.key === key) last.count += 1;
    else monthSegments.push({ key, label: `${y}年${m + 1}月`, count: 1 });
  }

  return (
    <>
      {/* 引っ張って更新インジケータ（最上部に固定表示） */}
      {(pullDist > 0 || refreshing) && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
          style={{
            top: "calc(var(--safe-top) + 6px)",
            opacity: refreshing ? 1 : Math.min(1, pullDist / 70),
          }}
        >
          <div className="flex items-center gap-2 rounded-full bg-card-bg px-3 py-1.5 text-[14px] font-medium text-foreground shadow ring-1 ring-card-border">
            {refreshing ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-accent" />
                更新中…
              </>
            ) : (
              <span>{pullDist >= 70 ? "離して更新" : "引っ張って更新"}</span>
            )}
          </div>
        </div>
      )}
      <div
        className="pb-24"
        style={{
          transform: pullDist ? `translateY(${pullDist}px)` : undefined,
          transition: pullRef.current.active ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* ヘッダー（左: CredoBody ロゴ / 右: ユーザーアイコン）。スクロールしても固定 */}
        <header
          className="sticky top-0 z-30 -mx-4 mb-3 border-b border-card-border bg-background px-4"
          style={{ paddingTop: "var(--safe-top)" }}
        >
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/icon.png" alt="" className="h-7 w-7" />
              <span className="text-[17px] font-semibold text-foreground">
                CredoBodyRise
              </span>
              {/* 開発ビルド (`astro dev`) でのみ LOCAL バッジを表示。
                  本番ビルドでは import.meta.env.DEV が false なので出力されない。 */}
              {import.meta.env.DEV && (
                <span
                  className="rounded bg-yellow-400 px-1.5 py-0.5 text-[11px] font-bold text-yellow-900"
                  aria-hidden
                >
                  LOCAL
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {supabase && session && <AnnouncementBellButton />}
              {supabase && session && (
              <button
                onClick={() => setView("profile")}
                className="h-9 w-9 overflow-hidden rounded-full bg-slate-200 ring-1 ring-card-border dark:bg-slate-700"
                aria-label="プロフィール"
              >
                {myAvatarUrl ? (
                  <img
                    src={myAvatarUrl}
                    alt="プロフィール"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      className="h-5 w-5"
                    >
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                    </svg>
                  </span>
                )}
              </button>
              )}
            </div>
          </div>
        </header>

        {items.length === 0 ? (
          <p className="mt-6 text-center text-[15px] text-muted">
            種目がありません。「設定」タブから登録してください。
          </p>
        ) : (
          <>
            <div className="mb-2 flex justify-end gap-2">
              {supabase && session && (
                <button
                  onClick={refreshData}
                  disabled={refreshing}
                  aria-label="更新"
                  title="更新"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-card-bg text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
                  >
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => {
                  if (gridScrollRef.current)
                    gridScrollRef.current.scrollLeft =
                      gridScrollRef.current.scrollWidth;
                }}
                aria-label="今日へ"
                title="今日へ"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-card-bg text-slate-600 dark:border-slate-600 dark:text-slate-300"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </button>
            </div>
            {/* 種目名は左固定・日付部分は横スクロール。日付ヘッダ行は縦スクロールで上端固定。 */}
            <div
              ref={gridScrollRef}
              className="mt-3 overflow-auto overscroll-none rounded-2xl border border-card-border bg-card-bg dark:border-slate-800 dark:bg-slate-900"
              style={{
                maxHeight:
                  "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 200px)",
              }}
            >
              <div style={{ minWidth: NAME_W + gridDays.length * CELL_W }}>
                {/* 日付ヘッダー（縦スクロールしても上端に固定）。月バンド＋曜日/日の2段。 */}
                <div className="sticky top-0 z-30 bg-card-bg dark:bg-slate-900">
                  {/* 月バンド（横スクロールしても、見えている月のラベルは左に残る） */}
                  <div className="flex items-stretch">
                    <div
                      className="sticky left-0 z-40 bg-card-bg dark:bg-slate-900"
                      style={{ width: NAME_W }}
                    />
                    {monthSegments.map((seg) => (
                      <div
                        key={seg.key}
                        className="shrink-0 border-l border-slate-200 py-1 first:border-l-0 dark:border-slate-700"
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
                  {/* 曜日 + 日 */}
                  <div className="flex items-stretch border-b border-card-border dark:border-slate-800">
                    <div
                      className="sticky left-0 z-40 flex items-center border-r border-card-border bg-card-bg px-3 py-2 text-[15px] font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                      style={{ width: NAME_W }}
                    >
                      種目
                    </div>
                    {gridDays.map((d, i) => {
                      const isToday = ymd(d) === todayStr;
                      const wd = d.getDay();
                      const isWeekStart = wd === weekStart;
                      return (
                        <div
                          key={i}
                          className={`shrink-0 py-2 text-center ${
                            isWeekStart
                              ? "border-l border-slate-300 dark:border-slate-600"
                              : ""
                          }`}
                          style={{ width: CELL_W }}
                        >
                          <div
                            className={`text-[13px] ${
                              wd === 0
                                ? "text-red-500"
                                : wd === 6
                                  ? "text-blue-500"
                                  : "text-muted"
                            }`}
                          >
                            {WD[wd]}
                          </div>
                          <div
                            className={`mx-auto mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[14px] font-semibold ${
                              isToday
                                ? "bg-accent text-white"
                                : "text-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {d.getDate()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* トレーニング時間（分）の行 */}
                <div className="flex items-stretch border-b-2 border-slate-200 dark:border-slate-700">
                  <div
                    className="sticky left-0 z-10 flex items-center gap-1.5 border-r border-card-border bg-card-bg px-2 py-2 dark:border-slate-800 dark:bg-slate-900"
                    style={{ width: NAME_W }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: TIME_COLOR }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-slate-900 dark:text-slate-100">
                        トレーニング時間
                      </span>
                      <span className="block text-[12px] text-muted">
                        今週 {weekMinutes()}分
                      </span>
                    </span>
                  </div>
                  {gridDays.map((d, i) => {
                    const v = dayMinutes[ymd(d)] ?? 0;
                    const isWeekStart = d.getDay() === weekStart;
                    return (
                      <button
                        key={i}
                        onClick={() => openEditor(d)}
                        className={`flex h-12 shrink-0 items-center justify-center active:bg-slate-100 dark:active:bg-slate-800 ${
                          isWeekStart
                            ? "border-l border-slate-300 dark:border-slate-600"
                            : ""
                        }`}
                        style={{ width: CELL_W }}
                      >
                        <span
                          className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-[13px] font-semibold"
                          style={
                            v
                              ? { backgroundColor: TIME_COLOR, color: "#fff" }
                              : { boxShadow: "inset 0 0 0 1.5px rgb(203 213 225)" }
                          }
                        >
                          {v ? `${v}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 項目行（実施チェック） */}
                {items.map((it) => {
                  const doneCount = weekDoneCount(it.id);
                  return (
                    <div
                      key={it.id}
                      className="flex items-stretch border-b border-slate-100 last:border-b-0 dark:border-slate-800"
                    >
                      <div
                        className="sticky left-0 z-10 flex items-center gap-1.5 border-r border-card-border bg-card-bg px-2 py-2 dark:border-slate-800 dark:bg-slate-900"
                        style={{ width: NAME_W }}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: it.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium text-slate-900 dark:text-slate-100">
                            {it.name}
                          </span>
                          <span className="block text-[12px] text-muted">
                            今週 {doneCount}日
                          </span>
                        </span>
                      </div>
                      {gridDays.map((d, i) => {
                        const done = (minutes[`${it.id}:${ymd(d)}`] ?? 0) > 0;
                        const isWeekStart = d.getDay() === weekStart;
                        return (
                          <button
                            key={i}
                            onClick={() => toggleItem(it.id, d)}
                            className={`flex h-12 shrink-0 items-center justify-center active:bg-slate-100 dark:active:bg-slate-800 ${
                              isWeekStart
                                ? "border-l border-slate-300 dark:border-slate-600"
                                : ""
                            }`}
                            style={{ width: CELL_W }}
                          >
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[15px] font-bold"
                              style={
                                done
                                  ? { backgroundColor: it.color, color: "#fff" }
                                  : { boxShadow: "inset 0 0 0 1.5px rgb(203 213 225)", color: "#cbd5e1" }
                              }
                            >
                              {done ? "✓" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 日別トレーニング時間の入力モーダル */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card-bg p-5 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
              トレーニング時間
            </div>
            <div className="text-[13px] text-muted">
              {editing.getMonth() + 1}/{editing.getDate()}（{WD[editing.getDay()]}）
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                placeholder="0"
                autoFocus
                className="w-full rounded-lg border border-slate-300 bg-card-bg px-3 py-2.5 text-[18px] font-semibold text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <span className="text-[16px] font-medium text-slate-700 dark:text-slate-300">
                分
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_TIME.map((m) => (
                <button
                  key={m}
                  onClick={() => setEditVal(String(m))}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-[15px] font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                >
                  {m}分
                </button>
              ))}
            </div>

            {cellError && (
              <p className="mt-4 text-[14px] font-medium text-red-600 dark:text-red-400">
                {cellError}
              </p>
            )}

            <button
              onClick={applyEditor}
              disabled={cellBusy}
              className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {cellBusy ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => setEditing(null)}
              disabled={cellBusy}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-card-bg px-4 py-2.5 text-[16px] font-medium text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      {tabBar}
    </>
  );
}
