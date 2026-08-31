import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateMedalSummary, formatSignedMedals } from "../js/summary.js";
import { formatCounterProbability } from "../js/counters.js";
import { REACTION_LABELS } from "../js/instructions.js";
import { PLAYER_STATUS_ICONS } from "../js/session.js";

const caseOne = calculateMedalSummary({
  startingMedals: 0,
  currentMedals: 1240,
  cashInvestmentYen: 3000,
  lendYenUnit: 1000,
  lendMedalsPerUnit: 46,
});
assert.equal(caseOne.investmentMedals, 138);
assert.equal(caseOne.differenceMedals, 1102);
assert.equal(formatSignedMedals(caseOne.differenceMedals), "+1,102枚");

const caseTwo = calculateMedalSummary({
  startingMedals: 500,
  currentMedals: 800,
  cashInvestmentYen: 0,
  lendYenUnit: 1000,
  lendMedalsPerUnit: 46,
});
assert.equal(caseTwo.differenceMedals, 300);

assert.equal(formatCounterProbability({ count: 12, phase_key: "total" }, { total_games: 892 }), "1/74.3");
assert.deepEqual(Object.keys(REACTION_LABELS), ["seen", "acknowledged", "question"]);
assert.equal(PLAYER_STATUS_ICONS.need_help, "!");
assert.equal(PLAYER_STATUS_ICONS.finished, "■");

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "DOM id must be unique");
assert.ok(html.indexOf('id="summary-current-game"') < html.indexOf('id="summary-total-games"'), "現在G must appear before 総G");
assert.match(html, /id="finished-sessions-folder"/);
assert.match(html, /id="image-upload-form"/);
assert.match(html, /data-session-tab="image"/);
assert.match(html, /id="hard-delete-session-button"/);
assert.match(html, /name="tag"/);

const boardForm = html.match(/<form id="comment-form"[\s\S]*?<\/form>/)?.[0] ?? "";
assert.ok(boardForm, "掲示板フォームが必要です");
assert.doesNotMatch(boardForm, /target_event_id|target_instruction_id/, "掲示板はセッション全体の会話に限定する");

const v03 = await readFile(new URL("../supabase/migrations/2026083103_wwb_v03_live_workspace.sql", import.meta.url), "utf8");
for (const needle of [
  "current_medals",
  "show_on_live",
  "acquired_medals",
  "adjust_current_medals",
  "set_counter_live_visibility",
  "instruction_id, user_id, reaction",
]) assert.ok(v03.includes(needle), `v0.3 migration is missing ${needle}`);

const v04 = await readFile(new URL("../supabase/migrations/2026083104_wwb_v04_visibility_images_cleanup.sql", import.meta.url), "utf8");
for (const needle of [
  "add column if not exists tag",
  "create table if not exists public.session_images",
  "wwb-session-images",
  "hard_delete_session",
  "session_images",
]) assert.ok(v04.includes(needle), `v0.4 migration is missing ${needle}`);

const render = await readFile(new URL("../js/render.js", import.meta.url), "utf8");
assert.doesNotMatch(render, /instruction-card[^\n]*<details>/, "指示カードは常時開いた状態にする");
assert.match(render, /data-instruction-comment-form/);
assert.match(render, /instruction-target-card/);
assert.match(render, /event\.tag/);

console.log("WWB v0.4 smoke tests passed");
