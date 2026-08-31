export const COUNTER_PHASES = Object.freeze({
  total: "総G",
  normal: "通常G",
  at: "AT G",
  bonus: "BONUS G",
  custom: "任意分母",
});

export async function listCounters(supabase, sessionId) {
  const { data, error } = await supabase.from("counter_items").select("*").eq("session_id", sessionId)
    .order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createCounter(supabase, sessionId, userId, { name, phaseKey = "total", customDenominator = null }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("カウンター名を入力してください。");
  if (!Object.hasOwn(COUNTER_PHASES, phaseKey)) throw new Error("分母種別が不正です。");
  const custom = phaseKey === "custom" ? Math.max(0, Number(customDenominator) || 0) : null;
  if (phaseKey === "custom" && custom <= 0) throw new Error("任意分母を入力してください。");

  const { data, error } = await supabase.from("counter_items").insert({
    session_id: sessionId,
    name: cleanName,
    phase_key: phaseKey,
    custom_denominator: custom,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function adjustCounter(supabase, counterId, delta) {
  const { data, error } = await supabase.rpc("adjust_counter_item", {
    p_counter_id: counterId,
    p_delta: Math.trunc(Number(delta) || 0),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function setCounterLiveVisibility(supabase, counterId, showOnLive) {
  const { data, error } = await supabase.rpc("set_counter_live_visibility", {
    p_counter_id: counterId,
    p_show: Boolean(showOnLive),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export function counterDenominator(counter, metrics) {
  if (!counter) return 0;
  switch (counter.phase_key) {
    case "total": return Number(metrics?.total_games || 0);
    case "normal": return Number(metrics?.normal_games || 0);
    case "at": return Number(metrics?.at_games || 0);
    case "bonus": return Number(metrics?.bonus_games || 0);
    case "custom": return Number(counter.custom_denominator || 0);
    default: return 0;
  }
}

export function formatCounterProbability(counter, metrics) {
  const count = Number(counter?.count || 0);
  const denominator = counterDenominator(counter, metrics);
  if (count <= 0 || denominator <= 0) return "—";
  return `1/${(denominator / count).toFixed(1)}`;
}
