import { COUNTER_PHASES, formatCounterProbability } from "./counters.js";
import { EVENT_LABELS } from "./events.js";
import { INSTRUCTION_PRIORITIES, REACTION_ICONS, REACTION_LABELS } from "./instructions.js";
import { METRIC_LABELS } from "./metrics.js";
import { PLAYER_STATUSES, PLAYER_STATUS_ICONS } from "./session.js";
import { calculateMedalSummary, formatSignedMedals, resolveCurrentMedals } from "./summary.js";

const LIFECYCLE_LABELS = Object.freeze({ active: "進行中", paused: "休止", finished: "終了" });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function text(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function number(value) {
  return Number(value || 0).toLocaleString("ja-JP");
}

function authorLabel(userId, currentUserId, members = []) {
  if (userId === currentUserId) return "自分";
  const member = members.find((item) => item.user_id === userId);
  return member?.display_name || (member?.role === "player" ? "打ち手" : member?.role === "requester" ? "依頼側" : "相手");
}

export function formatJapanTime(value, includeDate = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    ...(includeDate ? { month: "numeric", day: "numeric" } : {}),
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function formatElapsed(startedAt, endedAt = null, now = new Date()) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "経過 —";
  const totalMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `経過 ${hours ? `${hours}時間` : ""}${minutes}分`;
}

function recentSessionCard(row) {
  const lifecycle = row.lifecycleStatus || "active";
  const playerStatus = row.playerStatus || "ready";
  const medalSummary = calculateMedalSummary({
    startingMedals: row.starting_medals ?? row.startingMedals,
    currentMedals: row.current_medals ?? row.currentMedals,
    cashInvestmentYen: row.cash_investment_yen ?? row.cashInvestmentYen,
    lendYenUnit: row.lend_yen_unit ?? row.lendYenUnit,
    lendMedalsPerUnit: row.lend_medals_per_unit ?? row.lendMedalsPerUnit,
  });
  const statusLabel = lifecycle === "finished" ? "終了" : (PLAYER_STATUSES[playerStatus] || playerStatus);
  const statusIcon = lifecycle === "finished" ? PLAYER_STATUS_ICONS.finished : (PLAYER_STATUS_ICONS[playerStatus] || "●");
  return `<button class="recent-session-card" data-lifecycle="${escapeHtml(lifecycle)}" data-status="${escapeHtml(playerStatus)}" type="button" data-open-session="${escapeHtml(row.sessionId)}" data-share-code="${escapeHtml(row.shareCode || "")}" data-cache-only="${row.cacheOnly ? "true" : "false"}">
    <span><small>${escapeHtml(row.store_name || row.storeName || "店舗未設定")}</small><strong>${escapeHtml(row.machine_name || row.machineName || "機種未設定")}</strong><small>${escapeHtml(row.machine_number || row.machineNumber || "—")}番台</small></span>
    <span class="recent-meta"><span class="recent-badges"><span class="lifecycle-badge" data-lifecycle="${escapeHtml(lifecycle)}">${escapeHtml(LIFECYCLE_LABELS[lifecycle] || lifecycle)}</span><span class="status-badge" data-status="${escapeHtml(playerStatus)}"><b>${escapeHtml(statusIcon)}</b>${escapeHtml(statusLabel)}</span></span>${row.cacheOnly ? '<span class="cache-badge">端末履歴</span>' : ""}<strong class="recent-difference">${escapeHtml(formatSignedMedals(medalSummary.differenceMedals))}</strong><small>現在 ${number(row.current_game ?? row.currentGame)}G</small></span>
  </button>`;
}

export function renderRecentSessions(rows) {
  const activeList = document.querySelector("#recent-sessions-list");
  const finishedList = document.querySelector("#finished-sessions-list");
  const finishedFolder = document.querySelector("#finished-sessions-folder");
  const finishedCount = document.querySelector("#finished-sessions-count");
  const state = document.querySelector("#recent-sessions-state");
  const activeRows = rows.filter((row) => (row.lifecycleStatus || "active") !== "finished");
  const finishedRows = rows.filter((row) => (row.lifecycleStatus || "active") === "finished");

  activeList.innerHTML = activeRows.map(recentSessionCard).join("");
  finishedList.innerHTML = finishedRows.length
    ? finishedRows.map(recentSessionCard).join("")
    : '<div class="panel-state compact-state">終了済みセッションはありません。</div>';
  finishedCount.textContent = String(finishedRows.length);
  finishedFolder.dataset.empty = String(finishedRows.length === 0);

  if (!rows.length) {
    state.textContent = "まだ参加したセッションはありません。";
    state.hidden = false;
  } else if (!activeRows.length) {
    state.textContent = "進行中のセッションはありません。終了済みは下のフォルダにあります。";
    state.hidden = false;
  } else {
    state.hidden = true;
  }
}

export function renderSessionChrome(session, role) {
  const lifecycle = session.lifecycle_status || "active";
  const workspace = document.querySelector("#session-view");
  workspace.dataset.lifecycle = lifecycle;
  text("#role-label", role === "player" ? "PLAYER" : "REQUESTER");
  text("#lifecycle-label", LIFECYCLE_LABELS[lifecycle] || lifecycle);
  document.querySelector("#lifecycle-label").dataset.lifecycle = lifecycle;
  text("#session-title", session.machine_name || "—");
  text("#session-subtitle", `${session.store_name || "—"} · ${session.machine_number || "—"}番台`);
  text("#share-code", session.share_code || "—");
  text("#detail-role", role === "player" ? "player（作成者）" : "requester（参加者）");
  text("#detail-store", session.store_name || "—");
  text("#detail-machine", `${session.machine_name || "—"} / ${session.machine_number || "—"}番台`);
  text("#detail-started-at", formatJapanTime(session.started_at));
  text("#detail-rental", `${number(session.lend_yen_unit)}円 → ${number(session.lend_medals_per_unit)}枚`);
  text("#detail-exchange", `${number(session.exchange_medals_per_unit)}枚 → ${number(session.exchange_yen_unit)}円`);
  text("#detail-initial-cash", `${number(session.initial_cash_yen)}円`);
  text("#detail-starting-medals", `${number(session.starting_medals)}枚`);
  text("#elapsed-time", formatElapsed(session.started_at, session.ended_at));
  const hardDeleteCard = document.querySelector("#hard-delete-card");
  hardDeleteCard.hidden = !(lifecycle === "finished" && role === "player");
  renderStatus(session);
  applyFinishedState(lifecycle === "finished");
}

export function renderStatus(session) {
  const status = session.player_status || "ready";
  text("#current-status", PLAYER_STATUSES[status] || status);
  text("#current-status-message", session.player_status_message || "メッセージはありません");
  text("#status-updated-at", `最終更新：${formatJapanTime(session.player_status_updated_at || session.started_at)}`);
  const card = document.querySelector("#status-card");
  const icon = document.querySelector("#status-icon");
  if (card) card.dataset.status = status;
  if (icon) icon.textContent = PLAYER_STATUS_ICONS[status] || "●";
  const radios = document.querySelector("#status-form")?.elements.namedItem("player_status");
  if (radios) radios.value = status;
  const message = document.querySelector('#status-form [name="player_status_message"]');
  if (message && document.activeElement !== message) message.value = session.player_status_message || "";
}

export function renderMetrics(metrics) {
  for (const metric of Object.keys(METRIC_LABELS)) text(`#metric-${metric}`, number(metrics?.[metric]));
  text("#metric-normal_games-detail", number(metrics?.normal_games));
  text("#metric-at_games-detail", number(metrics?.at_games));
  text("#metric-bonus_games-detail", number(metrics?.bonus_games));
  text("#summary-current-game", `${number(metrics?.current_game)}G`);
  text("#summary-total-games", `${number(metrics?.total_games)}G`);
}

export function renderLiveSummary(session, metrics, eventSummary) {
  const currentMedals = resolveCurrentMedals(metrics, eventSummary, session.starting_medals);
  const summary = calculateMedalSummary({
    startingMedals: session.starting_medals,
    currentMedals,
    cashInvestmentYen: eventSummary.cashInvestmentYen,
    lendYenUnit: session.lend_yen_unit,
    lendMedalsPerUnit: session.lend_medals_per_unit,
  });
  text("#summary-difference", formatSignedMedals(summary.differenceMedals));
  text("#summary-current-medals", `${number(summary.currentMedals)}枚`);
  text("#difference-starting-medals", `${number(summary.startingMedals)}枚`);
  text("#difference-cash", `${number(summary.cashInvestmentYen)}円`);
  text("#difference-investment-medals", `${number(summary.investmentMedals)}枚`);
  text("#difference-current-medals", `${number(summary.currentMedals)}枚`);
  const difference = document.querySelector("#summary-difference");
  difference.classList.toggle("is-positive", summary.differenceMedals > 0);
  difference.classList.toggle("is-negative", summary.differenceMedals < 0);
  return summary;
}

export function renderEventSummary(summary) {
  text("#summary-cash", `${number(summary.cashInvestmentYen)}円`);
  text("#summary-medals", `${number(summary.medalInvestment)}枚`);
  text("#summary-payout", `${number(summary.currentPayoutMedals)}枚`);
}

function eventValueTokens(event) {
  const values = [];
  if (event.cash_yen != null) values.push(`${number(event.cash_yen)}円`);
  if (event.medal_delta != null) values.push(`${number(Math.abs(event.medal_delta))}枚`);
  if (event.payout_medals != null) values.push(`持ちメダル ${number(event.payout_medals)}枚`);
  if (event.game_count != null) values.push(`${number(event.game_count)}G`);
  if (event.acquired_medals != null) values.push(`獲得 ${number(event.acquired_medals)}枚`);
  return values;
}

function eventBadge(event) {
  if (event.tag) return `<span class="event-tag">${escapeHtml(event.tag)}</span>`;
  if (event.acquired_medals != null) return '<span class="event-tag system-tag">AT終了</span>';
  if (event.event_type !== "hit" && EVENT_LABELS[event.event_type]) {
    return `<span class="event-tag system-tag">${escapeHtml(EVENT_LABELS[event.event_type])}</span>`;
  }
  return "";
}

export function renderEvents(events) {
  const list = document.querySelector("#event-list");
  if (!events.length) {
    list.innerHTML = '<div class="panel-state">まだログはありません。</div>';
    return;
  }
  list.innerHTML = events.map((event) => {
    const values = eventValueTokens(event);
    return `<article class="event-card${event.voided_at ? " is-voided" : ""}">
      <div class="event-head"><div><small>${escapeHtml(formatJapanTime(event.created_at, false))}</small><h4>${escapeHtml(event.label || EVENT_LABELS[event.event_type] || event.event_type)}</h4></div>${event.voided_at ? `<small>取消済み: ${escapeHtml(event.void_reason || "取消")}</small>` : eventBadge(event)}</div>
      ${values.length ? `<div class="event-values">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>` : ""}
      ${event.note ? `<p>${escapeHtml(event.note)}</p>` : ""}
      ${event.voided_at ? "" : `<button class="link-action session-action" data-link-event="${escapeHtml(event.id)}" data-target-name="${escapeHtml(event.label || EVENT_LABELS[event.event_type] || "ログ")}" type="button">このログに指示を付ける</button><button class="link-action danger-text session-action" data-void-event="${escapeHtml(event.id)}" type="button">取消</button>`}
    </article>`;
  }).join("");
}

function counterCard(counter, metrics, { live = false } = {}) {
  return `<article class="counter-card${live ? " live-counter-card" : ""}">
    <div class="counter-head"><div><h4>${escapeHtml(counter.name)}</h4><small>${escapeHtml(COUNTER_PHASES[counter.phase_key] || counter.phase_key)}</small></div><strong>${escapeHtml(formatCounterProbability(counter, metrics))}</strong></div>
    <div class="counter-controls"><button class="session-action" data-adjust-counter="${escapeHtml(counter.id)}" data-delta="-1" type="button" aria-label="${escapeHtml(counter.name)}を1減らす">−</button><div class="counter-value"><strong>${number(counter.count)}</strong><span>回</span></div><button class="session-action" data-adjust-counter="${escapeHtml(counter.id)}" data-delta="1" type="button" aria-label="${escapeHtml(counter.name)}を1増やす">＋</button></div>
    ${live ? "" : `<div class="counter-card-actions"><button class="live-toggle session-action${counter.show_on_live ? " is-on" : ""}" data-toggle-live-counter="${escapeHtml(counter.id)}" data-show="${counter.show_on_live ? "false" : "true"}" type="button" aria-pressed="${counter.show_on_live ? "true" : "false"}">${counter.show_on_live ? "★ ライブ表示中" : "☆ ライブに表示"}</button><button class="link-action session-action" data-link-counter="${escapeHtml(counter.id)}" data-target-name="${escapeHtml(counter.name)}" type="button">指示を付ける</button></div>`}
  </article>`;
}

export function renderCounters(counters, metrics) {
  const list = document.querySelector("#counter-list");
  if (!counters.length) {
    list.innerHTML = '<div class="panel-state">カウンターを追加するとここに表示されます。</div>';
    return;
  }
  list.innerHTML = counters.map((counter) => counterCard(counter, metrics)).join("");
}

export function renderLiveCounters(counters, metrics) {
  const section = document.querySelector("#live-counters-section");
  const list = document.querySelector("#live-counter-list");
  const liveCounters = counters.filter((counter) => counter.show_on_live).slice(0, 4);
  section.hidden = liveCounters.length === 0;
  list.innerHTML = liveCounters.map((counter) => counterCard(counter, metrics, { live: true })).join("");
}

function instructionTargetDetail(instruction, eventById, counterById) {
  if (instruction.target_type === "event") {
    const event = eventById.get(instruction.target_event_id);
    if (!event) return '<div class="instruction-target-card is-missing"><small>参照ログ</small><strong>元ログが見つかりません</strong></div>';
    const values = eventValueTokens(event);
    return `<div class="instruction-target-card">
      <div class="instruction-target-head"><small>参照ログ · ${escapeHtml(formatJapanTime(event.created_at, false))}</small>${eventBadge(event)}</div>
      <strong>${escapeHtml(event.label || EVENT_LABELS[event.event_type] || event.event_type)}</strong>
      ${values.length ? `<div class="event-values">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>` : ""}
      ${event.note ? `<p>${escapeHtml(event.note)}</p>` : ""}
    </div>`;
  }
  if (instruction.target_type === "counter") {
    const counter = counterById.get(instruction.target_counter_id);
    return `<div class="instruction-target-card"><small>参照カウンター</small><strong>${escapeHtml(counter?.name || "カウンター")}</strong></div>`;
  }
  if (instruction.target_type === "field") {
    return `<div class="instruction-target-card"><small>参照項目</small><strong>${escapeHtml(instruction.target_field || "項目")}</strong></div>`;
  }
  return "";
}

function instructionCommentHtml(comment, currentUserId, members) {
  const mine = comment.created_by === currentUserId;
  return `<div class="instruction-comment${mine ? " is-mine" : ""}"><div><strong>${escapeHtml(authorLabel(comment.created_by, currentUserId, members))}</strong><small>${escapeHtml(formatJapanTime(comment.created_at, false))}</small></div><p>${escapeHtml(comment.body)}</p></div>`;
}

export function renderInstructions(instructions, reactions, currentUserId, comments = [], members = [], events = [], counters = []) {
  const list = document.querySelector("#instruction-list");
  if (!instructions.length) {
    list.innerHTML = '<div class="panel-state">共有された指示メモはありません。</div>';
    return;
  }
  const byInstruction = new Map();
  for (const reaction of reactions) {
    if (!byInstruction.has(reaction.instruction_id)) byInstruction.set(reaction.instruction_id, []);
    byInstruction.get(reaction.instruction_id).push(reaction);
  }
  const commentsByInstruction = new Map();
  for (const comment of comments.filter((item) => item.target_instruction_id)) {
    if (!commentsByInstruction.has(comment.target_instruction_id)) commentsByInstruction.set(comment.target_instruction_id, []);
    commentsByInstruction.get(comment.target_instruction_id).push(comment);
  }
  const eventById = new Map(events.map((event) => [event.id, event]));
  const counterById = new Map(counters.map((counter) => [counter.id, counter]));

  list.innerHTML = instructions.map((instruction) => {
    const related = byInstruction.get(instruction.id) || [];
    const mine = new Set(related.filter((reaction) => reaction.user_id === currentUserId).map((reaction) => reaction.reaction));
    const reactionButtons = Object.entries(REACTION_LABELS).map(([value, label]) => {
      const count = related.filter((reaction) => reaction.reaction === value).length;
      const active = mine.has(value);
      return `<button class="reaction-button session-action${active ? " is-mine" : ""}" data-instruction-reaction="${escapeHtml(instruction.id)}" data-reaction="${value}" data-active="${active}" aria-pressed="${active}" type="button">${REACTION_ICONS[value]} ${label} <span class="reaction-count">${count}</span></button>`;
    }).join("");
    const instructionComments = commentsByInstruction.get(instruction.id) || [];
    const targetDetail = instructionTargetDetail(instruction, eventById, counterById);
    return `<article class="instruction-card${instruction.pinned ? " is-pinned" : ""}" data-instruction-id="${escapeHtml(instruction.id)}">
      <header class="instruction-head"><span><small>${instruction.pinned ? "📌 " : ""}${escapeHtml(formatJapanTime(instruction.created_at, false))}</small><strong>${escapeHtml(instruction.title || "指示")}</strong></span><span class="priority-badge" data-priority="${escapeHtml(instruction.priority)}">${escapeHtml(INSTRUCTION_PRIORITIES[instruction.priority] || instruction.priority)}</span></header>
      ${instruction.body ? `<p class="instruction-body">${escapeHtml(instruction.body)}</p>` : '<p class="instruction-body muted">本文はありません。</p>'}
      ${targetDetail}
      <div class="reaction-row">${reactionButtons}</div>
      <section class="instruction-comments"><div class="instruction-comment-title"><strong>コメント</strong><span>${instructionComments.length}</span></div>${instructionComments.length ? instructionComments.map((comment) => instructionCommentHtml(comment, currentUserId, members)).join("") : '<p class="instruction-comment-empty">まだコメントはありません。</p>'}
        <form class="instruction-comment-form session-action" data-instruction-comment-form="${escapeHtml(instruction.id)}"><label class="sr-only">指示へのコメント</label><input name="body" maxlength="500" placeholder="質問・返答を追加" required><button type="submit">送信</button></form>
      </section>
    </article>`;
  }).join("");
}

export function renderComments(comments, currentUserId, members = []) {
  const list = document.querySelector("#comment-list");
  const boardComments = (comments ?? []).filter((comment) => !comment.target_event_id && !comment.target_instruction_id);
  if (!boardComments.length) {
    list.innerHTML = '<div class="panel-state">まだ投稿はありません。</div>';
    return;
  }
  list.innerHTML = boardComments.map((comment) => {
    const mine = comment.created_by === currentUserId;
    const author = authorLabel(comment.created_by, currentUserId, members);
    return `<article class="comment-bubble${mine ? " is-mine" : ""}"><small class="comment-author">${escapeHtml(author)}</small><p>${escapeHtml(comment.body)}</p><small>${escapeHtml(formatJapanTime(comment.created_at, false))}</small></article>`;
  }).join("");
}

export function renderImages(images, currentUserId) {
  const list = document.querySelector("#image-list");
  if (!images?.length) {
    list.innerHTML = '<div class="panel-state image-empty-state">まだ画像はありません。</div>';
    return;
  }
  list.innerHTML = images.map((image) => `<article class="image-card">
    ${image.signed_url ? `<a class="image-preview-link" href="${escapeHtml(image.signed_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(image.signed_url)}" alt="${escapeHtml(image.caption || "共有画像")}" loading="lazy"></a>` : '<div class="image-missing">画像を読み込めません</div>'}
    <div class="image-card-meta"><div><strong>${escapeHtml(image.caption || "画像")}</strong><small>${escapeHtml(formatJapanTime(image.created_at))}</small></div><button class="link-action danger-text session-action" data-delete-image="${escapeHtml(image.id)}" type="button">削除</button></div>
  </article>`).join("");
}

export function applyFinishedState(finished) {
  const workspace = document.querySelector("#session-view");
  workspace.classList.toggle("is-finished", finished);
  document.querySelector("#finished-banner").hidden = !finished;
  document.querySelector("#finish-session-button").hidden = finished;
  workspace.querySelectorAll(".session-action").forEach((element) => {
    if (element.matches("form")) {
      const disabled = finished || element.getAttribute("aria-busy") === "true";
      [...element.elements].forEach((control) => { control.disabled = disabled; });
    } else if (finished || element.dataset.busy !== "true") {
      element.disabled = finished;
    }
  });
}
