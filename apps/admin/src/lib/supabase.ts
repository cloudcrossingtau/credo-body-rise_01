import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

// Supabase JS v2 のデフォルトは navigator.locks を使ったロックだが、
// Safari 等の一部ブラウザでロック解放が遅延し、認証操作や SELECT クエリが
// ハングする事象が報告されている (特にログイン直後・タブ復帰直後)。
// 単一タブで使う想定のため、no-op ロックに置き換えて並行実行を許可する。
// （nouker と同じ構成。トークン更新の競合は auth-js が内部で直列化するため安全）
const noopLock = async <R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => fn();

// Safari のタブ復帰／スリープ復帰後に、supabase-js が内部で行うリクエスト
// （トークン更新や SELECT/変更クエリ）が「返っても失敗もしない」宙ぶらりんのまま
// ハングし、以降の getSession() が全て詰まる事象への根本対処。
// 全 fetch に上限時間を設け、超えたら abort して必ず「失敗」で決着させる。
// これで詰まったセッション状態が解除され、上位の withRetry がやり直せる
// （＝リトライが実際に効くようになる）。上位の書き込みタイムアウト(8秒)より
// 短くして、アプリが諦める前に fetch 側で打ち切って詰まりを解くのが狙い。
const FETCH_TIMEOUT_MS = 7000;
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // 呼び出し側が渡した signal も尊重する（どちらかが abort したら中断）。
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
};

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { lock: noopLock },
        global: { fetch: fetchWithTimeout },
      })
    : null;
