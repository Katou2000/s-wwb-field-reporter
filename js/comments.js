export async function listComments(supabase, sessionId) {
  const { data, error } = await supabase.from("comments").select("*").eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createComment(supabase, sessionId, userId, { body, targetEventId = null, targetInstructionId = null }) {
  const clean = String(body || "").trim();
  if (!clean) throw new Error("コメントを入力してください。");
  const { data, error } = await supabase.from("comments").insert({
    session_id: sessionId,
    target_event_id: targetEventId,
    target_instruction_id: targetInstructionId,
    body: clean,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}
