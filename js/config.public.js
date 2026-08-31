async function loadConfig() {
  try {
    return await import("./config.js");
  } catch {
    try {
      return await import("./config.public.js");
    } catch {
      throw new SupabaseConfigurationError(
        "Supabase設定ファイルが見つかりません。",
      );
    }
  }
}