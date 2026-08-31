export const METRIC_LABELS = Object.freeze({
  current_game: "現在G",
  total_games: "総G",
  normal_games: "通常G",
  at_games: "AT G",
  bonus_games: "BONUS G",
});

export const EMPTY_METRICS = Object.freeze({
  current_game: 0,
  total_games: 0,
  normal_games: 0,
  at_games: 0,
  bonus_games: 0,
});

export async function loadMetrics(supabase, sessionId) {
  const { data, error } = await supabase.from("session_metrics").select("*").eq("session_id", sessionId).single();
  if (error) throw error;
  return data;
}

export async function adjustMetric(supabase, sessionId, metric, { delta = 0, setValue = null } = {}) {
  if (!Object.hasOwn(METRIC_LABELS, metric)) throw new Error("未対応のゲーム数項目です。");
  const normalizedSetValue = setValue === null || setValue === ""
    ? null
    : Math.max(0, Math.trunc(Number(setValue) || 0));
  const { data, error } = await supabase.rpc("adjust_session_metric", {
    p_session_id: sessionId,
    p_metric: metric,
    p_delta: Math.trunc(Number(delta) || 0),
    p_set_value: normalizedSetValue,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
