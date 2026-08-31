export const PLAYER_STATUSES = Object.freeze({
  ready: "準備中",
  playing: "稼働中",
  need_help: "判断ほしい",
  waiting_instruction: "指示待ち",
  checking: "確認中",
  break: "休憩",
  finished: "終了",
});

export const PLAYER_STATUS_ICONS = Object.freeze({
  ready: "○",
  playing: "▶",
  need_help: "!",
  waiting_instruction: "…",
  checking: "?",
  break: "Ⅱ",
  finished: "■",
});

export function getJapanDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

function requiredText(formData, name) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error("必須項目を入力してください。");
  return value;
}

function nonNegativeNumber(formData, name) {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value) || value < 0) throw new Error("数値項目を正しく入力してください。");
  return value;
}

export function buildSessionPayload(formData, now = new Date()) {
  return {
    store_name: requiredText(formData, "store_name"),
    machine_name: requiredText(formData, "machine_name"),
    machine_number: requiredText(formData, "machine_number"),
    lend_yen_unit: nonNegativeNumber(formData, "rental_yen"),
    lend_medals_per_unit: nonNegativeNumber(formData, "rental_medals"),
    exchange_medals_per_unit: nonNegativeNumber(formData, "exchange_medals"),
    exchange_yen_unit: nonNegativeNumber(formData, "exchange_yen"),
    initial_cash_yen: nonNegativeNumber(formData, "starting_funds"),
    starting_medals: nonNegativeNumber(formData, "starting_medals"),
    session_date: getJapanDate(now),
    started_at: now.toISOString(),
  };
}

export async function createSession(supabase, payload) {
  const { data, error } = await supabase.from("sessions").insert(payload).select("*").single();
  if (error) throw error;
  if (!data?.id || !data?.share_code) throw new Error("セッションIDまたは共有コードを取得できませんでした。");
  return data;
}

function extractSessionId(result) {
  const value = Array.isArray(result) ? result[0] : result;
  if (typeof value === "string") return value;
  return value?.session_id ?? value?.id ?? null;
}

export async function joinSessionByCode(supabase, shareCode, displayName) {
  const params = { p_code: shareCode.trim().toUpperCase(), p_display_name: displayName.trim() || null };
  const { data, error } = await supabase.rpc("join_session_by_code", params);
  if (error) throw error;
  const sessionId = extractSessionId(data);
  if (!sessionId) throw new Error("参加先のセッションIDを取得できませんでした。");
  return loadSession(supabase, sessionId);
}

export async function loadSession(supabase, sessionId) {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
  if (error) throw error;
  return data;
}

export async function getMemberRole(supabase, sessionId, userId) {
  const { data, error } = await supabase
    .from("session_members").select("role").eq("session_id", sessionId).eq("user_id", userId).single();
  if (error) throw error;
  if (!data?.role) throw new Error("このセッションでの役割を確認できませんでした。");
  return data.role;
}

export async function listSessionMembers(supabase, sessionId) {
  const { data, error } = await supabase.from("session_members")
    .select("session_id,user_id,role,display_name,joined_at")
    .eq("session_id", sessionId).order("joined_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updatePlayerStatus(supabase, sessionId, status, message) {
  if (!Object.hasOwn(PLAYER_STATUSES, status)) throw new Error("不正なステータスです。");
  const payload = {
    player_status: status,
    player_status_message: message.trim() || null,
    player_status_updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("sessions").update(payload).eq("id", sessionId).select("*").single();
  if (error) throw error;
  return data;
}

export async function finishSession(supabase, sessionId) {
  const { data, error } = await supabase.rpc("finish_session", { p_session_id: sessionId });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.id) throw new Error("終了したセッションを取得できませんでした。");
  return result;
}

export async function hardDeleteSession(supabase, sessionId) {
  const { error } = await supabase.rpc("hard_delete_session", { p_session_id: sessionId });
  if (error) throw error;
}

const V02_RPC_NAMES = Object.freeze([
  "finish_session",
  "list_my_sessions",
  "touch_session_member",
  "adjust_session_metric",
  "adjust_counter_item",
  "adjust_current_medals",
  "set_counter_live_visibility",
  "hard_delete_session",
]);

export function isMissingV02RpcError(error) {
  const code = String(error?.code ?? "");
  const description = [error?.message, error?.details, error?.hint]
    .filter(Boolean).join(" ").toLowerCase();
  const isMissingFunction = code === "PGRST202"
    || code === "42883"
    || /function .* does not exist|could not find the function.*schema cache/.test(description);
  return isMissingFunction && V02_RPC_NAMES.some((name) => description.includes(name));
}
