let activeChannel = null;

const SESSION_TABLES = [
  "sessions",
  "session_metrics",
  "events",
  "counter_items",
  "instructions",
  "instruction_reactions",
  "comments",
  "session_members",
  "session_images",
];

export async function unsubscribeFromSession(supabase) {
  if (!activeChannel || !supabase) return;
  const channel = activeChannel;
  activeChannel = null;
  await supabase.removeChannel(channel);
}

export async function subscribeToSession(supabase, sessionId, { onTableChange, onStateChange }) {
  await unsubscribeFromSession(supabase);
  let channel = supabase.channel(`session:v03:${sessionId}`);

  for (const table of SESSION_TABLES) {
    const filter = table === "sessions"
      ? `id=eq.${sessionId}`
      : table === "instruction_reactions" ? null : `session_id=eq.${sessionId}`;
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
      (payload) => onTableChange?.(table, payload),
    );
  }

  activeChannel = channel.subscribe((status) => onStateChange?.(status));
  return activeChannel;
}
