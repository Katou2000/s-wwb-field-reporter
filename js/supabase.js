let client = null;

export class SupabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

function isPlaceholder(value) {
  return !value || value.startsWith("YOUR_");
}

const CONFIG_MODULE_PATHS = Object.freeze(["./config.js", "./config.public.js"]);

export async function loadConfig(modulePaths = CONFIG_MODULE_PATHS) {
  for (const modulePath of modulePaths) {
    try {
      return await import(modulePath);
    } catch {
      // Local config is optional on static hosting; continue to the public config.
    }
  }
  throw new SupabaseConfigurationError(
    "Supabase設定を読み込めません。js/config.jsまたはjs/config.public.jsを確認してください。",
  );
}

function waitForSupabaseLibrary(timeoutMs = 8000) {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.supabase?.createClient) {
        window.clearInterval(timer);
        resolve(window.supabase);
      } else if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("Supabaseライブラリを読み込めませんでした。通信環境を確認してください。"));
      }
    }, 50);
  });
}

export async function initializeSupabase() {
  if (client) return client;

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await loadConfig();
  if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_PUBLISHABLE_KEY)) {
    throw new SupabaseConfigurationError(
      "Supabase設定のSUPABASE_URLとSUPABASE_PUBLISHABLE_KEYを実際の値に置き換えてください。",
    );
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL)) {
    throw new SupabaseConfigurationError("SUPABASE_URLの形式が正しくありません。");
  }

  const library = await waitForSupabaseLibrary();
  client = library.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export function getSupabase() {
  if (!client) throw new Error("Supabaseが初期化されていません。");
  return client;
}
