import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = process.cwd();
const safeModules = new Set([
  "counters.js", "events.js", "instructions.js", "metrics.js", "render.js",
  "session.js", "summary.js", "theme.js",
]);

const fixtureScript = `
<script type="module">
  import { summarizeEvents } from "/js/events.js";
  import {
    renderComments, renderCounters, renderEventSummary, renderEvents, renderImages, renderInstructions,
    renderLiveCounters, renderLiveSummary, renderMetrics, renderSessionChrome,
  } from "/js/render.js";
  import { applyTheme } from "/js/theme.js";

  const params = new URL(location.href).searchParams;
  if (params.get("theme") === "dark") applyTheme("dark");
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== "session-view"; });
  document.querySelector("#session-loading").hidden = true;
  document.querySelector("#connection-state").textContent = "接続済み";
  const session = {
    id: "session-1", store_name: "テストホール長い店舗名", machine_name: "WWB テスト機種名",
    machine_number: "123", share_code: "ABC123", lifecycle_status: params.get("finished") === "1" ? "finished" : "active", player_status: params.get("status") || "need_help",
    player_status_message: "通常時を確認しながら続行中です", player_status_updated_at: "2026-08-31T06:32:00Z",
    started_at: "2026-08-31T05:00:00Z", ended_at: null, starting_medals: 0,
    lend_yen_unit: 1000, lend_medals_per_unit: 46, exchange_medals_per_unit: 56, exchange_yen_unit: 1000,
    initial_cash_yen: 30000,
  };
  const metrics = { current_game: 327, total_games: 2841, normal_games: 2120, at_games: 641, bonus_games: 80, current_medals: 1240 };
  const events = [
    { id: "e2", event_type: "hit", label: "奥義", tag: "当選", game_count: 327, acquired_medals: 820, note: "獲得枚数と持ちメダルは別管理", created_at: "2026-08-31T06:32:00Z" },
    { id: "e1", event_type: "cash_investment", cash_yen: 3000, created_at: "2026-08-31T05:10:00Z" },
  ];
  const counters = [
    { id: "c1", name: "弱チェリー", phase_key: "total", count: 12, show_on_live: true },
    { id: "c2", name: "スイカ（長い名称でも折り返す）", phase_key: "total", count: 8, show_on_live: true },
  ];
  const instructions = [{ id: "i1", title: "終了画面について", body: "この当選ログを見て、次の動きを確認したいです。コメントは常時見える状態です。", target_type: "event", target_event_id: "e2", priority: "high", pinned: true, created_at: "2026-08-31T06:30:00Z" }];
  const reactions = [
    { instruction_id: "i1", user_id: "me", reaction: "seen" },
    { instruction_id: "i1", user_id: "me", reaction: "acknowledged" },
    { instruction_id: "i1", user_id: "other", reaction: "seen" },
    { instruction_id: "i1", user_id: "other", reaction: "question" },
  ];
  const members = [{ user_id: "me", role: "player", display_name: "打ち手" }, { user_id: "other", role: "requester", display_name: "依頼側" }];
  const comments = [
    { created_by: "other", body: "今どんな感じ？ 長いコメントが続いた場合にも横スクロールせず、読みやすく折り返されることを確認します。", created_at: "2026-08-31T06:31:00Z" },
    { created_by: "me", body: "327G、今のところ特になし", created_at: "2026-08-31T06:32:00Z" },
    { created_by: "other", target_instruction_id: "i1", body: "この終了画面、もう一枚確認できる？", created_at: "2026-08-31T06:33:00Z" },
  ];
  const eventSummary = summarizeEvents(events, session.starting_medals);
  renderSessionChrome(session, "player");
  renderMetrics(metrics);
  renderEventSummary(eventSummary);
  renderLiveSummary(session, metrics, eventSummary);
  renderCounters(counters, metrics);
  renderLiveCounters(counters, metrics);
  renderEvents(events);
  renderInstructions(instructions, reactions, "me", comments, members, events, counters);
  renderComments(comments, "me", members);
  renderImages([], "me");

  const requestedTab = params.get("tab");
  if (requestedTab) {
    document.querySelectorAll("[data-session-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.sessionTab === requestedTab));
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== requestedTab; });
  }

  const options = document.querySelector("#options-dialog");
  document.querySelector("#open-options-button").addEventListener("click", () => options.showModal());
  options.querySelectorAll('[name="theme"]').forEach((radio) => radio.addEventListener("change", () => applyTheme(radio.value)));
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("[data-open-at-end]").forEach((button) => button.addEventListener("click", () => document.querySelector("#at-end-dialog").showModal()));
  document.querySelector("#open-instruction-button").addEventListener("click", () => document.querySelector("#instruction-dialog").showModal());
  document.querySelectorAll("[data-session-tab]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-session-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== button.dataset.sessionTab; });
  }));
  document.querySelectorAll("[data-collab-view]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-collab-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    document.querySelectorAll("[data-collab-panel]").forEach((panel) => { panel.hidden = panel.dataset.collabPanel !== button.dataset.collabView; });
  }));
</script>`;

createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let html = await readFile(join(root, "index.html"), "utf8");
      html = html
        .replace(/\s*<script defer src="https:\/\/cdn\.jsdelivr\.net[^>]+><\/script>/, "")
        .replace(/\s*<script type="module" src="js\/app\.js"><\/script>/, "")
        .replace("</body>", fixtureScript + "</body>");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (url.pathname === "/css/style.css") {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(await readFile(join(root, "css", "style.css")));
      return;
    }
    if (url.pathname.startsWith("/js/")) {
      const file = url.pathname.slice(4);
      if (!safeModules.has(file)) throw new Error("Module not allowed");
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(await readFile(join(root, "js", file)));
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.message);
  }
}).listen(8765, "127.0.0.1", () => console.log("fixture ready http://127.0.0.1:8765"));
