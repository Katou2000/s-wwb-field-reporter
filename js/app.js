import { ensureAnonymousAuth } from "./auth.js";
import { createComment, listComments } from "./comments.js";
import {
  adjustCounter, createCounter, listCounters, setCounterLiveVisibility,
} from "./counters.js";
import {
  addAtEnd, addCashInvestment, addHit, addMedalInvestment, addMemo, addSimpleEvent,
  adjustCurrentMedals, listEvents, summarizeEvents, voidEvent,
} from "./events.js";
import {
  forgetSession, listMySessions, mergeRecentSessions, readRecentSessionCache, rememberSession, touchSessionMember,
} from "./history.js";
import {
  createInstruction, listInstructionReactions, listInstructions, toggleInstructionReaction,
} from "./instructions.js";
import { listSessionImages, removeAllSessionImageObjects, uploadSessionImage, deleteSessionImage } from "./images.js";
import { adjustMetric, EMPTY_METRICS, loadMetrics } from "./metrics.js";
import { subscribeToSession, unsubscribeFromSession } from "./realtime.js";
import {
  applyFinishedState, formatElapsed, renderComments, renderCounters, renderEvents,
  renderEventSummary, renderImages, renderInstructions, renderLiveCounters, renderLiveSummary,
  renderMetrics, renderRecentSessions, renderSessionChrome, renderStatus,
} from "./render.js";
import {
  PLAYER_STATUSES, PLAYER_STATUS_ICONS, buildSessionPayload, createSession, finishSession, getMemberRole,
  hardDeleteSession, isMissingV02RpcError, joinSessionByCode, listSessionMembers, loadSession, updatePlayerStatus,
} from "./session.js";
import { initializeSupabase, SupabaseConfigurationError } from "./supabase.js";
import { applyTheme, initializeTheme, readTheme } from "./theme.js";

const views = [...document.querySelectorAll(".view")];
const notice = document.querySelector("#notice");
const connectionState = document.querySelector("#connection-state");
const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const statusForm = document.querySelector("#status-form");
const sessionView = document.querySelector("#session-view");
const instructionDialog = document.querySelector("#instruction-dialog");
const atEndDialog = document.querySelector("#at-end-dialog");
const optionsDialog = document.querySelector("#options-dialog");

initializeTheme();

let supabase = null;
let currentUser = null;
let elapsedTimer = null;
let reloadTimer = null;
let pendingRealtimeTables = new Set();

const state = {
  session: null,
  role: null,
  metrics: { ...EMPTY_METRICS },
  events: [],
  counters: [],
  instructions: [],
  reactions: [],
  comments: [],
  members: [],
  images: [],
  realtimeConnected: false,
};

function showView(id) {
  views.forEach((view) => { view.hidden = view.id !== id; });
  notice.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showNotice(message, type = "error") {
  notice.textContent = message;
  notice.className = `notice${type === "success" ? " success" : ""}`;
  notice.hidden = false;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function errorMessage(error) {
  console.error(error);
  const message = String(error?.message || "");
  if (error?.code === "PGRST116") return "対象のデータが見つからないか、閲覧権限がありません。";
  if (error?.code === "23505") return "すでに登録済みです。画面を更新して確認してください。";
  if (/not a session member/i.test(message)) return "このセッションのメンバーではないため操作できません。";
  if (/session not found or already finished/i.test(message)) return "共有コードが違うか、セッションはすでに終了しています。";
  if (/live counter limit reached/i.test(message)) return "ライブ表示できるカウンターは最大4件です。";
  if (/bucket not found|session_images|schema cache.*tag|could not find.*tag/i.test(message)) return "v0.4用Supabase migration（2026083104）が未適用の可能性があります。";
  if (isMissingV02RpcError(error)) return "必要なSupabase migrationが未適用の可能性があります。";
  return message || "処理に失敗しました。通信環境を確認してください。";
}

function setBusy(form, busy) {
  const keepDisabled = !busy && form.closest("#session-view") && state.session?.lifecycle_status === "finished";
  [...form.elements].forEach((element) => { element.disabled = busy || keepDisabled; });
  form.setAttribute("aria-busy", String(busy));
}

async function runButtonAction(button, action, successMessage = null) {
  button.dataset.busy = "true";
  button.disabled = true;
  try {
    await action();
    if (successMessage) showNotice(successMessage, "success");
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    delete button.dataset.busy;
    button.disabled = state.session?.lifecycle_status === "finished";
  }
}

function ensureEditable() {
  if (!state.session) throw new Error("セッションを開いてください。");
  if (state.session.lifecycle_status === "finished") throw new Error("終了済みセッションは編集できません。");
}

function renderStatusOptions() {
  const container = document.querySelector("#status-options");
  Object.entries(PLAYER_STATUSES).forEach(([value, label], index) => {
    const choice = document.createElement("label");
    choice.className = "status-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "player_status";
    input.value = value;
    input.required = true;
    input.checked = index === 0;
    const text = document.createElement("span");
    text.textContent = `${PLAYER_STATUS_ICONS[value] || "●"} ${label}`;
    choice.append(input, text);
    container.append(choice);
  });
}

function switchTab(name) {
  document.querySelectorAll("[data-session-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sessionTab === name);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== name;
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateElapsed() {
  if (!state.session) return;
  document.querySelector("#elapsed-time").textContent = formatElapsed(state.session.started_at, state.session.ended_at);
}

function renderCollaborativeData() {
  renderSessionChrome(state.session, state.role);
  renderMetrics(state.metrics);
  const eventSummary = summarizeEvents(state.events, state.session.starting_medals);
  renderEventSummary(eventSummary);
  const medalSummary = renderLiveSummary(state.session, state.metrics, eventSummary);
  renderEvents(state.events);
  renderCounters(state.counters, state.metrics);
  renderLiveCounters(state.counters, state.metrics);
  renderInstructions(state.instructions, state.reactions, currentUser.id, state.comments, state.members, state.events, state.counters);
  renderComments(state.comments, currentUser.id, state.members);
  renderImages(state.images, currentUser.id);
  rememberSession(state.session, state.role, {
    currentGame: state.metrics.current_game,
    currentMedals: medalSummary.currentMedals,
    cashInvestmentYen: eventSummary.cashInvestmentYen,
  });
  applyFinishedState(state.session.lifecycle_status === "finished");
}

async function loadAllSessionData() {
  const sessionId = state.session?.id;
  if (!sessionId) return;
  const [metrics, events, counters, instructions, comments, members, images] = await Promise.all([
    loadMetrics(supabase, sessionId),
    listEvents(supabase, sessionId),
    listCounters(supabase, sessionId),
    listInstructions(supabase, sessionId),
    listComments(supabase, sessionId),
    listSessionMembers(supabase, sessionId),
    listSessionImages(supabase, sessionId),
  ]);
  const reactions = await listInstructionReactions(supabase, instructions.map((item) => item.id));
  if (state.session?.id !== sessionId) return;
  Object.assign(state, { metrics, events, counters, instructions, reactions, comments, members, images });
  renderCollaborativeData();
  document.querySelector("#session-loading").hidden = true;
}

async function reloadForTables(tables) {
  if (!state.session) return;
  const sessionId = state.session.id;
  if (tables.has("session_metrics")) state.metrics = await loadMetrics(supabase, sessionId);
  if (tables.has("events")) state.events = await listEvents(supabase, sessionId);
  if (tables.has("counter_items")) state.counters = await listCounters(supabase, sessionId);
  if (tables.has("instructions")) state.instructions = await listInstructions(supabase, sessionId);
  if (tables.has("comments")) state.comments = await listComments(supabase, sessionId);
  if (tables.has("session_members")) state.members = await listSessionMembers(supabase, sessionId);
  if (tables.has("session_images")) state.images = await listSessionImages(supabase, sessionId);
  if (tables.has("instructions") || tables.has("instruction_reactions")) {
    state.reactions = await listInstructionReactions(supabase, state.instructions.map((item) => item.id));
  }
  if (state.session?.id === sessionId) renderCollaborativeData();
}

function scheduleRealtimeReload(table) {
  pendingRealtimeTables.add(table);
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(async () => {
    const tables = new Set(pendingRealtimeTables);
    pendingRealtimeTables.clear();
    try { await reloadForTables(tables); } catch (error) { showNotice(errorMessage(error)); }
  }, 120);
}

async function beginRealtime(sessionId) {
  state.realtimeConnected = false;
  await subscribeToSession(supabase, sessionId, {
    onTableChange: (table, payload) => {
      if (table === "sessions" && payload.new?.id === sessionId) {
        state.session = { ...state.session, ...payload.new };
        rememberSession(state.session, state.role);
        renderCollaborativeData();
      } else {
        scheduleRealtimeReload(table);
      }
    },
    onStateChange: async (status) => {
      const connected = status === "SUBSCRIBED";
      const indicator = document.querySelector("#realtime-indicator");
      indicator.textContent = connected ? "● LIVE" : "○ 再接続中";
      indicator.classList.toggle("offline", !connected);
      if (connected && !state.realtimeConnected) {
        state.realtimeConnected = true;
        try { await loadAllSessionData(); } catch (error) { showNotice(errorMessage(error)); }
      } else if (!connected) {
        state.realtimeConnected = false;
      }
    },
  });
}

async function refreshRecentSessions({ quiet = false } = {}) {
  const cached = readRecentSessionCache();
  renderRecentSessions(mergeRecentSessions([], cached));
  try {
    const remote = await listMySessions(supabase);
    renderRecentSessions(mergeRecentSessions(remote, cached));
  } catch (error) {
    document.querySelector("#recent-sessions-state").hidden = false;
    document.querySelector("#recent-sessions-state").textContent = cached.length
      ? "Supabase履歴を取得できないため端末履歴を表示しています。"
      : "履歴を取得できませんでした。v0.2 / v0.3 migrationを確認してください。";
    if (!quiet) showNotice(errorMessage(error));
  }
}

function resetSessionState() {
  Object.assign(state, {
    session: null,
    role: null,
    metrics: { ...EMPTY_METRICS },
    events: [],
    counters: [],
    instructions: [],
    reactions: [],
    comments: [],
    members: [],
    images: [],
    realtimeConnected: false,
  });
}

async function openSession(sessionOrId, fallbackRole = null) {
  const session = typeof sessionOrId === "string" ? await loadSession(supabase, sessionOrId) : sessionOrId;
  let role = fallbackRole;
  try {
    role = await getMemberRole(supabase, session.id, currentUser.id);
  } catch (error) {
    if (!fallbackRole) throw error;
    console.warn("session_membersから役割を取得できなかったため作成者のplayer役割を使用します。", error);
  }
  if (!["player", "requester"].includes(role)) throw new Error("未対応の役割です。");

  Object.assign(state, { session, role });
  try { await touchSessionMember(supabase, session.id); } catch (error) { console.warn("最終アクセスを更新できませんでした。", error); }
  rememberSession(session, role);
  renderSessionChrome(session, role);
  document.querySelector("#session-loading").hidden = false;
  switchTab("live");
  showView("session-view");
  await loadAllSessionData();
  await beginRealtime(session.id);
  window.clearInterval(elapsedTimer);
  elapsedTimer = window.setInterval(updateElapsed, 60000);
}

async function returnHome() {
  await unsubscribeFromSession(supabase);
  window.clearInterval(elapsedTimer);
  window.clearTimeout(reloadTimer);
  resetSessionState();
  showView("home-view");
  await refreshRecentSessions({ quiet: true });
}

function setInstructionTarget(type = "session", id = null, name = "") {
  const form = document.querySelector("#instruction-form");
  form.elements.target_type.value = type;
  form.elements.target_event_id.value = type === "event" ? id || "" : "";
  form.elements.target_counter_id.value = type === "counter" ? id || "" : "";
  form.elements.target_field.value = type === "field" ? id || "" : "";
  const label = document.querySelector("#instruction-target-label");
  if (type === "session") { label.hidden = true; label.replaceChildren(); return; }
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "解除";
  clear.addEventListener("click", () => setInstructionTarget());
  label.replaceChildren(document.createTextNode(`対象: ${name}`), clear);
  label.hidden = false;
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function switchCollaborationView(name) {
  document.querySelectorAll("[data-collab-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.collabView === name);
  });
  document.querySelectorAll("[data-collab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.collabPanel !== name;
  });
}

document.querySelector("#open-options-button").addEventListener("click", () => {
  const theme = readTheme();
  const radio = optionsDialog.querySelector(`[name="theme"][value="${theme}"]`);
  if (radio) radio.checked = true;
  openDialog(optionsDialog);
});

optionsDialog.querySelectorAll('[name="theme"]').forEach((radio) => {
  radio.addEventListener("change", () => applyTheme(radio.value));
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => closeDialog(button.closest("dialog")));
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
});

document.querySelectorAll("[data-collab-view]").forEach((button) => {
  button.addEventListener("click", () => switchCollaborationView(button.dataset.collabView));
});

document.querySelector("#open-instruction-button").addEventListener("click", () => {
  setInstructionTarget();
  openDialog(instructionDialog);
});

document.querySelectorAll("[data-open-at-end]").forEach((button) => {
  button.addEventListener("click", () => {
    const form = document.querySelector("#at-end-form");
    form.elements.game_count.value = state.metrics.current_game ?? 0;
    openDialog(atEndDialog);
  });
});

document.querySelector("[data-go-counter]").addEventListener("click", () => switchTab("counter"));

document.querySelector("#open-create-button").addEventListener("click", () => showView("create-view"));
document.querySelector("#open-join-button").addEventListener("click", () => showView("join-view"));
document.querySelectorAll("[data-back-home]").forEach((button) => button.addEventListener("click", returnHome));
document.querySelector("#leave-view-button").addEventListener("click", returnHome);
document.querySelector("#refresh-history-button").addEventListener("click", () => refreshRecentSessions());

async function handleRecentSessionClick(event) {
  const button = event.target.closest("[data-open-session]");
  if (!button) return;
  await runButtonAction(button, async () => {
    try {
      await openSession(button.dataset.openSession);
    } catch (error) {
      const canRecover = button.dataset.cacheOnly === "true"
        || error?.code === "PGRST116"
        || /not a session member/i.test(String(error?.message || ""));
      if (!button.dataset.shareCode || !canRecover) throw error;
      joinForm.elements.share_code.value = button.dataset.shareCode;
      showView("join-view");
      showNotice("この端末履歴を現在の匿名ユーザーへ復旧するには、共有コードで再参加してください。");
    }
  });
}

document.querySelector("#recent-sessions-list").addEventListener("click", handleRecentSessionClick);
document.querySelector("#finished-sessions-list").addEventListener("click", handleRecentSessionClick);

document.querySelectorAll("[data-session-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.sessionTab));
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  setBusy(createForm, true);
  try {
    const session = await createSession(supabase, buildSessionPayload(formData));
    await openSession(session, "player");
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    setBusy(createForm, false);
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(joinForm);
  setBusy(joinForm, true);
  try {
    const session = await joinSessionByCode(
      supabase,
      String(formData.get("share_code") ?? "").trim(),
      String(formData.get("display_name") ?? "").trim(),
    );
    await openSession(session);
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    setBusy(joinForm, false);
  }
});

statusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = statusForm.elements.player_status.value;
  const message = statusForm.elements.player_status_message.value;
  setBusy(statusForm, true);
  try {
    ensureEditable();
    state.session = await updatePlayerStatus(supabase, state.session.id, status, message);
    rememberSession(state.session, state.role);
    renderStatus(state.session);
    showNotice("ステータスを更新しました。", "success");
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    setBusy(statusForm, false);
    applyFinishedState(state.session?.lifecycle_status === "finished");
  }
});

document.querySelectorAll(".metric-set-form").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    setBusy(form, true);
    try {
      ensureEditable();
      state.metrics = await adjustMetric(supabase, state.session.id, form.dataset.metric, { setValue: formData.get("metric_value") });
      renderCollaborativeData();
    } catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
  });
});

document.querySelector("#cash-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try { ensureEditable(); await addCashInvestment(supabase, state.session.id, currentUser.id, formData.get("cash_yen")); form.reset(); await reloadForTables(new Set(["events"])); showNotice("現金投資を記録しました。", "success"); }
  catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#medal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try { ensureEditable(); await addMedalInvestment(supabase, state.session.id, currentUser.id, formData.get("medals")); form.reset(); await reloadForTables(new Set(["events"])); showNotice("持ちメダル投資を記録しました。", "success"); }
  catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#payout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try { ensureEditable(); state.metrics = await adjustCurrentMedals(supabase, state.session.id, { setValue: formData.get("payout_medals") }); form.reset(); await reloadForTables(new Set(["events"])); showNotice("現在持ちメダルを更新しました。", "success"); }
  catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#at-end-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try {
    ensureEditable();
    const acquiredMedals = formData.get("acquired_medals");
    await addAtEnd(supabase, state.session.id, currentUser.id, {
      gameCount: formData.get("game_count"),
      acquiredMedals,
      note: formData.get("note"),
    });
    const syncCurrentMedals = formData.has("sync_current_medals");
    if (syncCurrentMedals) {
      state.metrics = await adjustCurrentMedals(supabase, state.session.id, { setValue: acquiredMedals });
    }
    form.reset();
    closeDialog(atEndDialog);
    await reloadForTables(new Set(["events", ...(syncCurrentMedals ? ["session_metrics"] : [])]));
    showNotice(syncCurrentMedals
      ? "AT終了を記録し、獲得枚数を現在持ちメダルにも反映しました。"
      : "AT終了を記録しました。現在持ちメダルは変更していません。", "success");
  } catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector('#counter-form [name="phase_key"]').addEventListener("change", (event) => {
  document.querySelector("#custom-denominator-field").hidden = event.target.value !== "custom";
});

document.querySelector("#counter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try {
    ensureEditable();
    await createCounter(supabase, state.session.id, currentUser.id, { name: formData.get("name"), phaseKey: formData.get("phase_key"), customDenominator: formData.get("custom_denominator") });
    form.reset(); document.querySelector("#custom-denominator-field").hidden = true;
    await reloadForTables(new Set(["counter_items"])); showNotice("カウンターを追加しました。", "success");
  } catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#hit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try { ensureEditable(); await addHit(supabase, state.session.id, currentUser.id, { gameCount: formData.get("game_count"), label: formData.get("label"), tag: formData.get("tag"), note: formData.get("note") }); form.reset(); await reloadForTables(new Set(["events"])); showNotice("ログを追加しました。", "success"); }
  catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#memo-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try { ensureEditable(); await addMemo(supabase, state.session.id, currentUser.id, formData.get("note")); form.reset(); await reloadForTables(new Set(["events"])); showNotice("メモを追加しました。", "success"); }
  catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#instruction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try {
    ensureEditable();
    await createInstruction(supabase, state.session.id, currentUser.id, {
      title: formData.get("title"), body: formData.get("body"), priority: formData.get("priority"), pinned: formData.has("pinned"),
      targetType: formData.get("target_type"), targetEventId: formData.get("target_event_id"), targetCounterId: formData.get("target_counter_id"), targetField: formData.get("target_field"),
    });
    form.reset(); setInstructionTarget(); closeDialog(instructionDialog); await reloadForTables(new Set(["instructions"])); showNotice("指示メモを共有しました。", "success");
  } catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

document.querySelector("#comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  setBusy(form, true);
  try {
    ensureEditable();
    await createComment(supabase, state.session.id, currentUser.id, { body: formData.get("body") });
    form.reset(); await reloadForTables(new Set(["comments"])); document.querySelector("#comment-list").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) { showNotice(errorMessage(error)); } finally { setBusy(form, false); }
});

sessionView.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-instruction-comment-form]");
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  setBusy(form, true);
  try {
    ensureEditable();
    await createComment(supabase, state.session.id, currentUser.id, {
      body: formData.get("body"),
      targetInstructionId: form.dataset.instructionCommentForm,
    });
    form.reset();
    await reloadForTables(new Set(["comments"]));
    document.querySelector(`[data-instruction-id="${form.dataset.instructionCommentForm}"] .instruction-comment-form input`)?.focus();
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    setBusy(form, false);
  }
});

document.querySelector("#image-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const file = formData.get("image");
  setBusy(form, true);
  try {
    ensureEditable();
    if (!(file instanceof File) || !file.size) throw new Error("画像を選択してください。");
    if (file.size > 20 * 1024 * 1024) throw new Error("元画像が大きすぎます。20MB以下の画像を選んでください。");
    await uploadSessionImage(supabase, state.session.id, currentUser.id, file, formData.get("caption"));
    form.reset();
    await reloadForTables(new Set(["session_images"]));
    showNotice("画像を共有しました。", "success");
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    setBusy(form, false);
  }
});

sessionView.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;

  if (button.dataset.adjustMetric) {
    await runButtonAction(button, async () => { ensureEditable(); state.metrics = await adjustMetric(supabase, state.session.id, button.dataset.adjustMetric, { delta: button.dataset.delta }); renderCollaborativeData(); });
  } else if (button.dataset.setMetric) {
    await runButtonAction(button, async () => { ensureEditable(); state.metrics = await adjustMetric(supabase, state.session.id, button.dataset.setMetric, { setValue: button.dataset.value }); renderCollaborativeData(); }, "現在Gをリセットしました。");
  } else if (button.dataset.adjustMedals) {
    await runButtonAction(button, async () => { ensureEditable(); state.metrics = await adjustCurrentMedals(supabase, state.session.id, { delta: button.dataset.adjustMedals }); await reloadForTables(new Set(["events"])); }, "現在持ちメダルを更新しました。");
  } else if (button.dataset.cashInvestment) {
    await runButtonAction(button, async () => { ensureEditable(); await addCashInvestment(supabase, state.session.id, currentUser.id, button.dataset.cashInvestment); await reloadForTables(new Set(["events"])); }, "現金投資を記録しました。");
  } else if (button.dataset.medalInvestment) {
    await runButtonAction(button, async () => { ensureEditable(); await addMedalInvestment(supabase, state.session.id, currentUser.id, button.dataset.medalInvestment); await reloadForTables(new Set(["events"])); }, "持ちメダル投資を記録しました。");
  } else if (button.dataset.simpleEvent) {
    await runButtonAction(button, async () => { ensureEditable(); await addSimpleEvent(supabase, state.session.id, currentUser.id, button.dataset.simpleEvent); await reloadForTables(new Set(["events"])); }, "ログを追加しました。");
  } else if (button.dataset.adjustCounter) {
    await runButtonAction(button, async () => { ensureEditable(); const updated = await adjustCounter(supabase, button.dataset.adjustCounter, button.dataset.delta); state.counters = state.counters.map((item) => item.id === updated.id ? updated : item); renderCollaborativeData(); });
  } else if (button.dataset.toggleLiveCounter) {
    await runButtonAction(button, async () => { ensureEditable(); const updated = await setCounterLiveVisibility(supabase, button.dataset.toggleLiveCounter, button.dataset.show === "true"); state.counters = state.counters.map((item) => item.id === updated.id ? updated : item); renderCollaborativeData(); });
  } else if (button.dataset.voidEvent) {
    if (!window.confirm("このログを取り消しますか？データは削除されず、取消済みとして残ります。")) return;
    await runButtonAction(button, async () => { ensureEditable(); await voidEvent(supabase, button.dataset.voidEvent, "画面操作による取消"); await reloadForTables(new Set(["events"])); }, "ログを取り消しました。");
  } else if (button.dataset.linkEvent) {
    setInstructionTarget("event", button.dataset.linkEvent, button.dataset.targetName);
    switchTab("instruction");
    switchCollaborationView("instructions");
    openDialog(instructionDialog);
  } else if (button.dataset.linkCounter) {
    setInstructionTarget("counter", button.dataset.linkCounter, button.dataset.targetName);
    switchTab("instruction");
    switchCollaborationView("instructions");
    openDialog(instructionDialog);
  } else if (button.dataset.instructionReaction) {
    const instructionId = button.dataset.instructionReaction;
    const reaction = button.dataset.reaction;
    const wasActive = button.dataset.active === "true";
    await runButtonAction(button, async () => {
      ensureEditable();
      await toggleInstructionReaction(supabase, instructionId, currentUser.id, reaction, wasActive);
      await reloadForTables(new Set(["instruction_reactions"]));
      if (reaction === "question" && !wasActive) {
        requestAnimationFrame(() => document.querySelector(`[data-instruction-comment-form="${instructionId}"] input`)?.focus());
      }
    });
  } else if (button.dataset.deleteImage) {
    if (!window.confirm("この画像を削除しますか？")) return;
    const image = state.images.find((item) => item.id === button.dataset.deleteImage);
    if (!image) return;
    await runButtonAction(button, async () => {
      ensureEditable();
      await deleteSessionImage(supabase, image);
      state.images = state.images.filter((item) => item.id !== image.id);
      renderCollaborativeData();
    }, "画像を削除しました。");
  }
});

document.querySelector("#copy-code-button").addEventListener("click", async () => {
  const code = state.session?.share_code;
  if (!code) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
    else {
      const temporary = document.createElement("textarea");
      temporary.value = code; temporary.style.position = "fixed"; temporary.style.opacity = "0";
      document.body.append(temporary); temporary.select(); document.execCommand("copy"); temporary.remove();
    }
    showNotice("共有コードをコピーしました。", "success");
  } catch { showNotice("コピーできませんでした。コードを長押しして選択してください。"); }
});

document.querySelector("#finish-session-button").addEventListener("click", async (event) => {
  if (!window.confirm("セッションを終了しますか？終了後は履歴から閲覧できます。")) return;
  await runButtonAction(event.currentTarget, async () => {
    ensureEditable();
    state.session = await finishSession(supabase, state.session.id);
    rememberSession(state.session, state.role);
    await reloadForTables(new Set(["events"]));
    renderCollaborativeData();
  }, "セッションを終了しました。");
});

document.querySelector("#hard-delete-session-button").addEventListener("click", async (event) => {
  if (!state.session || state.session.lifecycle_status !== "finished") return;
  const confirmation = window.prompt("完全削除すると元に戻せません。削除する場合は『削除』と入力してください。");
  if (confirmation !== "削除") return;
  const button = event.currentTarget;
  button.disabled = true;
  button.dataset.busy = "true";
  try {
    const deletedId = state.session.id;
    await removeAllSessionImageObjects(supabase, state.images);
    await hardDeleteSession(supabase, deletedId);
    forgetSession(deletedId);
    await returnHome();
    showNotice("セッションを完全削除しました。", "success");
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    delete button.dataset.busy;
    button.disabled = false;
  }
});

window.addEventListener("pagehide", () => { void unsubscribeFromSession(supabase); });

async function start() {
  renderStatusOptions();
  renderRecentSessions(mergeRecentSessions([], readRecentSessionCache()));
  try {
    supabase = await initializeSupabase();
    currentUser = await ensureAnonymousAuth(supabase);
    connectionState.textContent = "接続済み";
    showView("home-view");
    await refreshRecentSessions({ quiet: true });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      document.querySelector("#setup-message").textContent = error.message;
      showView("setup-view");
      return;
    }
    connectionState.textContent = "未接続";
    showView("home-view");
    showNotice(errorMessage(error));
  }
}

void start();
