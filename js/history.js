const STORAGE_KEY = "wwb.recentSessions.v2";
const CACHE_LIMIT = 20;

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function readRecentSessionCache() {
  const rows = safeParse(localStorage.getItem(STORAGE_KEY), []);
  return Array.isArray(rows) ? rows : [];
}

export function rememberSession(session, role, snapshot = {}) {
  const sessionId = session.id ?? session.session_id;
  if (!sessionId) return;
  const cachedRows = readRecentSessionCache();
  const previous = cachedRows.find((row) => row.sessionId === sessionId) ?? {};
  const next = {
    sessionId,
    shareCode: session.share_code ?? session.shareCode ?? null,
    role,
    storeName: session.store_name ?? session.storeName ?? "",
    machineName: session.machine_name ?? session.machineName ?? "",
    machineNumber: session.machine_number ?? session.machineNumber ?? "",
    lifecycleStatus: session.lifecycle_status ?? session.lifecycleStatus ?? "active",
    playerStatus: session.player_status ?? session.playerStatus ?? "ready",
    currentGame: snapshot.currentGame ?? session.current_game ?? session.currentGame ?? previous.currentGame ?? 0,
    currentMedals: snapshot.currentMedals ?? session.current_medals ?? session.currentMedals ?? previous.currentMedals ?? session.starting_medals ?? 0,
    cashInvestmentYen: snapshot.cashInvestmentYen ?? session.cash_investment_yen ?? session.cashInvestmentYen ?? previous.cashInvestmentYen ?? 0,
    startingMedals: session.starting_medals ?? session.startingMedals ?? previous.startingMedals ?? 0,
    lendYenUnit: session.lend_yen_unit ?? session.lendYenUnit ?? previous.lendYenUnit ?? 0,
    lendMedalsPerUnit: session.lend_medals_per_unit ?? session.lendMedalsPerUnit ?? previous.lendMedalsPerUnit ?? 0,
    lastOpenedAt: new Date().toISOString(),
  };
  const rows = cachedRows.filter((row) => row.sessionId !== next.sessionId);
  rows.unshift(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, CACHE_LIMIT)));
}


export function forgetSession(sessionId) {
  const rows = readRecentSessionCache().filter((row) => row.sessionId !== sessionId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export async function listMySessions(supabase) {
  const { data, error } = await supabase.rpc("list_my_sessions");
  if (error) throw error;
  return data ?? [];
}

export async function touchSessionMember(supabase, sessionId) {
  const { error } = await supabase.rpc("touch_session_member", { p_session_id: sessionId });
  if (error) throw error;
}

export function mergeRecentSessions(remoteRows, cacheRows = readRecentSessionCache()) {
  const cacheById = new Map(cacheRows.map((row) => [row.sessionId, row]));
  const merged = (remoteRows ?? []).map((row) => {
    const cached = cacheById.get(row.session_id) ?? {};
    cacheById.delete(row.session_id);
    return {
      ...cached,
      ...row,
      sessionId: row.session_id,
      shareCode: row.share_code ?? cached.shareCode ?? null,
      role: row.member_role ?? cached.role ?? null,
      storeName: row.store_name ?? cached.storeName ?? "",
      machineName: row.machine_name ?? cached.machineName ?? "",
      machineNumber: row.machine_number ?? cached.machineNumber ?? "",
      lifecycleStatus: row.lifecycle_status ?? cached.lifecycleStatus ?? "active",
      playerStatus: row.player_status ?? cached.playerStatus ?? "ready",
      currentGame: row.current_game ?? cached.currentGame ?? 0,
      currentMedals: row.current_medals ?? cached.currentMedals ?? row.starting_medals ?? 0,
      cashInvestmentYen: row.cash_investment_yen ?? cached.cashInvestmentYen ?? 0,
      startingMedals: row.starting_medals ?? cached.startingMedals ?? 0,
      lendYenUnit: row.lend_yen_unit ?? cached.lendYenUnit ?? 0,
      lendMedalsPerUnit: row.lend_medals_per_unit ?? cached.lendMedalsPerUnit ?? 0,
      lastOpenedAt: row.last_opened_at ?? cached.lastOpenedAt ?? row.started_at,
      cacheOnly: false,
    };
  });

  for (const cached of cacheById.values()) merged.push({ ...cached, cacheOnly: true });
  return merged.sort((a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0));
}
