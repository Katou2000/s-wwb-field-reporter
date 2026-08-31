export const EVENT_LABELS = Object.freeze({
  cash_investment: "現金投資",
  medal_investment: "持ちメダル投資",
  payout_update: "現在出玉",
  game_update: "ゲーム数更新",
  hit: "当選",
  continue: "継続",
  break_start: "休憩開始",
  break_end: "休憩終了",
  memo: "メモ",
  at_end: "AT終了",
  finish: "終了",
});

export async function listEvents(supabase, sessionId) {
  const { data, error } = await supabase.from("events").select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function insertEvent(supabase, sessionId, userId, payload) {
  const { data, error } = await supabase
    .from("events").insert({ session_id: sessionId, created_by: userId, ...payload }).select("*").single();
  if (error) throw error;
  return data;
}

export function addCashInvestment(supabase, sessionId, userId, yen, note = null) {
  const cash = Math.max(0, Math.trunc(Number(yen)));
  if (!cash) throw new Error("投資金額を入力してください。");
  return insertEvent(supabase, sessionId, userId, { event_type: "cash_investment", cash_yen: cash, note: cleanOptional(note) });
}

export function addMedalInvestment(supabase, sessionId, userId, medals, note = null) {
  const value = Math.max(0, Math.trunc(Number(medals)));
  if (!value) throw new Error("投入枚数を入力してください。");
  return insertEvent(supabase, sessionId, userId, { event_type: "medal_investment", medal_delta: -value, note: cleanOptional(note) });
}

export function setCurrentPayout(supabase, sessionId, userId, medals, note = null) {
  const value = Math.max(0, Math.trunc(Number(medals) || 0));
  return insertEvent(supabase, sessionId, userId, { event_type: "payout_update", payout_medals: value, note: cleanOptional(note) });
}

export async function adjustCurrentMedals(supabase, sessionId, { delta = 0, setValue = null } = {}) {
  const normalizedSetValue = setValue === null || setValue === ""
    ? null
    : Math.max(0, Math.round(Number(setValue) || 0));
  const { data, error } = await supabase.rpc("adjust_current_medals", {
    p_session_id: sessionId,
    p_delta: Math.round(Number(delta) || 0),
    p_set_value: normalizedSetValue,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export function addAtEnd(supabase, sessionId, userId, { gameCount, acquiredMedals, note = null }) {
  const games = Math.max(0, Math.trunc(Number(gameCount) || 0));
  const acquired = Math.max(0, Math.round(Number(acquiredMedals) || 0));
  if (!acquired) throw new Error("獲得枚数を入力してください。");
  return insertEvent(supabase, sessionId, userId, {
    event_type: "hit",
    label: "AT終了",
    game_count: games,
    acquired_medals: acquired,
    note: cleanOptional(note),
  });
}

export function addHit(supabase, sessionId, userId, { gameCount = null, label, tag = null, note = null }) {
  const cleanLabel = String(label || "出来事").trim();
  return insertEvent(supabase, sessionId, userId, {
    event_type: "hit",
    game_count: gameCount === null || gameCount === "" ? null : Math.max(0, Math.trunc(Number(gameCount) || 0)),
    label: cleanLabel || "出来事",
    tag: cleanOptional(tag),
    note: cleanOptional(note),
  });
}

export function addMemo(supabase, sessionId, userId, note, label = "メモ") {
  const cleanNote = String(note || "").trim();
  if (!cleanNote) throw new Error("メモを入力してください。");
  return insertEvent(supabase, sessionId, userId, { event_type: "memo", label: String(label || "メモ").trim(), note: cleanNote });
}

export function addSimpleEvent(supabase, sessionId, userId, eventType, note = null) {
  if (!["continue", "break_start", "break_end"].includes(eventType)) throw new Error("未対応のイベントです。");
  return insertEvent(supabase, sessionId, userId, { event_type: eventType, note: cleanOptional(note) });
}

export async function voidEvent(supabase, eventId, reason = "取消") {
  const { data, error } = await supabase.from("events")
    .update({ voided_at: new Date().toISOString(), void_reason: String(reason || "取消").trim() || "取消" })
    .eq("id", eventId).select("*").single();
  if (error) throw error;
  return data;
}

export function summarizeEvents(events, startingMedals = 0) {
  const active = (events ?? []).filter((event) => !event.voided_at);
  const cashInvestmentYen = active.filter((event) => event.event_type === "cash_investment")
    .reduce((sum, event) => sum + Number(event.cash_yen || 0), 0);
  const medalInvestment = active.filter((event) => event.event_type === "medal_investment")
    .reduce((sum, event) => sum + Math.abs(Number(event.medal_delta || 0)), 0);
  const lastPayout = active.find((event) => event.event_type === "payout_update");
  return {
    cashInvestmentYen,
    medalInvestment,
    currentPayoutMedals: lastPayout?.payout_medals ?? startingMedals ?? 0,
  };
}

function cleanOptional(value) {
  return String(value || "").trim() || null;
}
