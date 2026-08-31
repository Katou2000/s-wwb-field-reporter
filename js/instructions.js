export const INSTRUCTION_PRIORITIES = Object.freeze({ low: "低", normal: "通常", high: "高" });
export const REACTION_LABELS = Object.freeze({ seen: "見た", acknowledged: "了解", question: "質問アリ" });
export const REACTION_ICONS = Object.freeze({ seen: "👁", acknowledged: "👍", question: "❓" });

export async function listInstructions(supabase, sessionId) {
  const { data, error } = await supabase.from("instructions").select("*").eq("session_id", sessionId)
    .is("archived_at", null).order("pinned", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createInstruction(supabase, sessionId, userId, input) {
  const title = String(input.title || "").trim();
  const body = String(input.body || "").trim();
  if (!title && !body) throw new Error("指示内容を入力してください。");
  const priority = Object.hasOwn(INSTRUCTION_PRIORITIES, input.priority) ? input.priority : "normal";
  const targetType = ["session", "event", "counter", "field"].includes(input.targetType) ? input.targetType : "session";

  const { data, error } = await supabase.from("instructions").insert({
    session_id: sessionId,
    target_type: targetType,
    target_event_id: targetType === "event" ? input.targetEventId || null : null,
    target_counter_id: targetType === "counter" ? input.targetCounterId || null : null,
    target_field: targetType === "field" ? input.targetField || null : null,
    title: title || "指示",
    body: body || null,
    priority,
    pinned: Boolean(input.pinned),
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function toggleInstructionReaction(supabase, instructionId, userId, reaction, isActive) {
  if (!Object.hasOwn(REACTION_LABELS, reaction)) throw new Error("未対応のリアクションです。");
  if (isActive) {
    const { error } = await supabase.from("instruction_reactions").delete()
      .eq("instruction_id", instructionId).eq("user_id", userId).eq("reaction", reaction);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase.from("instruction_reactions")
    .insert({ instruction_id: instructionId, user_id: userId, reaction });
  if (error && error.code !== "23505") throw error;
  return true;
}

export async function listInstructionReactions(supabase, instructionIds) {
  if (!instructionIds?.length) return [];
  const { data, error } = await supabase.from("instruction_reactions").select("*").in("instruction_id", instructionIds);
  if (error) throw error;
  return data ?? [];
}
