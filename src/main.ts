import "./style.css";
import { maxTile, MOVE_NAMES, type Move } from "./game/board.ts";
import { BoardView, type Timing } from "./game/render.ts";
import type { GameRecord } from "./mb/agent.ts";
import { forgetBrain, loadBrain, MbClient, storeBrain } from "./mb/client.ts";
import type { ReadyInfo, StepFrame, TurboFrame } from "./mb/protocol.ts";
import { BrainView } from "./ui/brain.ts";
import { CircuitView } from "./ui/circuit.ts";
import { CurveView, type Marker } from "./ui/curve.ts";
import { FuturesView } from "./ui/futures.ts";
import { C } from "./ui/theme.ts";

/** watch speeds: how long the fly smells, slides and settles per move (ms) */
const SPEEDS: { timing: Timing; rest: number }[] = [
  { timing: { sniff: 650, slide: 140, pop: 130 }, rest: 120 },
  { timing: { sniff: 140, slide: 80, pop: 60 }, rest: 20 },
  { timing: { sniff: 0, slide: 35, pop: 25 }, rest: 0 },
];
const TURBO = SPEEDS.length;
const GAME_OVER_MS = 1800;
const SAVE_EVERY_MS = 20_000;
const MARKERS_KEY = "20fly8:markers";
const ARROW = ["↑", "→", "↓", "←"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const loader = $("loader");
const client = new MbClient();
const board = new BoardView($<HTMLCanvasElement>("board"));
const futures = new FuturesView($<HTMLCanvasElement>("futures"));
const curve = new CurveView($<HTMLCanvasElement>("curve"));
const brain = new BrainView($<HTMLCanvasElement>("brain"));
let circuit: CircuitView;
let info: ReadyInfo;

const opts = { speed: 0, paused: false, noDopamine: false };
const history: GameRecord[] = [];
let markers: Marker[] = [];
let score = 0;
let game = 1;
let largest = 0;
let totalMoves = 0;
let plastic = 0;
let gameOverUntil = 0;
let lastStepAt = 0;
let numsAt = 0;
let lastSave = performance.now();
const rate: { t: number; moves: number; games: number }[] = [];

try {
  markers = JSON.parse(localStorage.getItem(MARKERS_KEY) ?? "[]") as Marker[];
} catch {
  markers = [];
}
const saveMarkers = () => {
  try {
    localStorage.setItem(MARKERS_KEY, JSON.stringify(markers));
  } catch {
    /* not persisted */
  }
};

function addRecords(recs: GameRecord[]): void {
  if (!recs.length) return;
  history.push(...recs);
  curve.set(history, markers);
}

function narrate(f: StepFrame): void {
  const el = $("narration");
  const d = f.dopamine;
  const kcs = fmt(f.kcs.length);
  const chose = `Chose <b>${ARROW[f.move]} ${MOVE_NAMES[f.move]}</b>`;
  if (opts.noDopamine) {
    el.innerHTML = `${chose}. <span class="bad">Dopamine is blocked</span>: the fly still picks the smell it likes best, but nothing that happens changes a synapse.`;
  } else if (f.gameOver) {
    el.innerHTML = `<b>Stuck</b> after ${fmt(f.moves)} moves. The last smell promised more than the game could give: <span class="bad">PPL1 dopamine</span> weakens its synapses onto approach neurons.`;
  } else if (Math.abs(d) < 0.08) {
    el.innerHTML = `${chose}. The last move went about as well as its smell promised, so the synapses hardly change.`;
  } else if (d > 0) {
    el.innerHTML = `${chose}. The last move went <span class="good">better than its smell promised (+${d.toFixed(2)})</span>: PAM dopamine weakens that smell’s synapses onto avoidance neurons in ${kcs} Kenyon cells.`;
  } else {
    el.innerHTML = `${chose}. The last move went <span class="bad">worse than its smell promised (−${Math.abs(d).toFixed(2)})</span>: PPL1 dopamine weakens that smell’s synapses onto approach neurons.`;
  }
}

function onStep(f: StepFrame): void {
  const now = performance.now();
  const sp = SPEEDS[Math.min(opts.speed, SPEEDS.length - 1)];
  const chosen = f.options[f.move].after;
  futures.show(f.options, f.before, f.move, now);
  board.playMove(f.before, f.move as Move, f.board, f.spawnCell, sp.timing, now);
  circuit.onStep(f, chosen, now);
  brain.flashKcs(f.kcs, now);
  if (!opts.noDopamine) brain.flashDopamine(f.dopamine, now);
  score = f.score;
  game = f.game;
  largest = maxTile(f.board);
  totalMoves = f.totalMoves;
  plastic = f.plastic;
  narrate(f);
  $("move-caption").textContent = f.gameOver
    ? `Stuck: no move left. Final score ${fmt(f.score)}.`
    : `${ARROW[f.move]} ${MOVE_NAMES[f.move]}${f.sugar ? ` · ${f.sugar} merge${f.sugar > 1 ? "s" : ""}, +${fmt(f.points)}` : ""}`;
  if (f.record) {
    addRecords([f.record]);
    gameOverUntil = now + board.busyFor(now) + GAME_OVER_MS;
  }
  rate.push({ t: now, moves: totalMoves, games: history.length });
}

function onTurbo(f: TurboFrame): void {
  const now = performance.now();
  board.setBoard(f.board);
  circuit.onTurbo(f, now);
  let d = 0;
  for (const x of f.dopamine) if (Math.abs(x) > Math.abs(d)) d = x;
  if (!opts.noDopamine) brain.flashDopamine(d, now);
  score = f.score;
  game = f.game;
  largest = maxTile(f.board);
  totalMoves = f.totalMoves;
  plastic = f.plastic;
  addRecords(f.records);
  rate.push({ t: now, moves: totalMoves, games: history.length });
  futures.turbo((f.movesDone * 4 * 1000) / Math.max(1, f.wallMs));
}

function updateText(now: number): void {
  while (rate.length > 2 && now - rate[0].t > 2500) rate.shift();
  const r0 = rate[0];
  const r1 = rate[rate.length - 1];
  const dt = r0 && r1 ? (r1.t - r0.t) / 1000 : 0;
  const mps = dt > 0.2 ? (r1.moves - r0.moves) / dt : 0;
  const gps = dt > 0.2 ? (r1.games - r0.games) / dt : 0;
  $("score").textContent = fmt(score);
  $("game-n").textContent = fmt(game);
  $("max-tile").textContent = largest ? fmt(2 ** largest) : "—";
  $("best").textContent = fmt(history.reduce((m, g) => Math.max(m, g.score), score));
  if (opts.speed === TURBO && !opts.paused) {
    $("move-caption").textContent = `Turbo: ${fmt(mps)} moves and ${gps.toFixed(gps < 10 ? 1 : 0)} games a second.`;
    $("narration").innerHTML = opts.noDopamine
      ? `The circuit runs exactly as at 1×, only ${fmt(mps)} times a second, but <span class="bad">with dopamine blocked</span> no synapse changes.`
      : `The circuit runs exactly as at 1×, only ${fmt(mps)} times a second, and dopamine still adjusts the synapses after every move. Watch panel d.`;
  }

  const last = history.slice(-100);
  const facts = $("facts");
  if (!last.length) {
    facts.innerHTML = `A naive fly: its synapses are exactly as the connectome has them, so it has no idea yet which boards are good.`;
    return;
  }
  const mean = last.reduce((s, g) => s + g.score, 0) / last.length;
  const pct = (e: number) => Math.round((100 * last.filter((g) => g.maxTile >= e).length) / last.length);
  const label = last.length < 100 ? `${last.length} game${last.length > 1 ? "s" : ""} so far` : "Last 100 games";
  facts.innerHTML =
    `${label}: average <b>${fmt(mean)}</b> (random moves: 1,067) · 512 in <b>${pct(9)} %</b> · 1024 in <b>${pct(10)} %</b> · 2048 in <b>${pct(11)} %</b>` +
    ` · ${fmt(plastic)} of ${fmt(info.kcMbonConnections)} synapses changed by more than 10 %`;
}

function veil(now: number): { title: string; line: string; tone: string } | null {
  if (opts.paused) return { title: "Paused", line: "press space to let the fly play", tone: C.ink };
  if (now < gameOverUntil && board.busyFor(now) <= 0) return { title: "Stuck", line: `final score ${fmt(score)}`, tone: C.punish };
  return null;
}

function tick(now: number): void {
  const turbo = opts.speed === TURBO;
  if (!opts.paused && !turbo && !client.pending && now >= gameOverUntil) {
    const sp = SPEEDS[opts.speed];
    if (board.busyFor(now) <= 0 && now - lastStepAt >= sp.rest) {
      lastStepAt = now;
      client.step();
    }
  }
  board.setVeil(veil(now));
  board.draw(now);
  futures.draw(now);
  circuit.draw(now);
  curve.draw();
  brain.render(now);
  if (now - numsAt > 250) {
    numsAt = now;
    updateText(now);
  }
  if (now - lastSave > SAVE_EVERY_MS) {
    lastSave = now;
    client.save();
  }
  requestAnimationFrame(tick);
}

function bindUi(): void {
  const play = $("play");
  const segs = [...document.querySelectorAll<HTMLButtonElement>(".seg button")];
  const dop = $("exp-dopamine");
  const sync = () => {
    play.classList.toggle("paused", opts.paused);
    play.setAttribute("aria-label", opts.paused ? "Play" : "Pause");
    play.title = opts.paused ? "Play (space)" : "Pause (space)";
    segs.forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.speed) === opts.speed)));
    dop.setAttribute("aria-pressed", String(opts.noDopamine));
    dop.textContent = opts.noDopamine ? "Dopamine blocked" : "Block dopamine";
  };
  const setSpeed = (s: number) => {
    const was = opts.speed === TURBO;
    opts.speed = s;
    if ((s === TURBO) !== was) client.turbo(s === TURBO && !opts.paused);
    if (s !== TURBO) $("move-caption").innerHTML = "&nbsp;";
    sync();
  };
  const togglePause = () => {
    opts.paused = !opts.paused;
    if (opts.speed === TURBO) client.turbo(!opts.paused);
    sync();
  };
  const toggleDopamine = () => {
    opts.noDopamine = !opts.noDopamine;
    client.learning(!opts.noDopamine);
    sync();
  };
  const flash = (el: HTMLElement) => {
    el.classList.add("done");
    setTimeout(() => el.classList.remove("done"), 500);
  };
  const rewire = () => {
    client.shuffle((Math.random() * 2 ** 31) | 0);
    markers.push({ game: history.length, label: "nose rewired" });
    saveMarkers();
    curve.set(history, markers);
    flash($("exp-rewire"));
  };
  const reset = () => {
    if (!confirm("Start over with a naive fly? Everything this one has learned will be forgotten.")) return;
    client.reset();
    history.length = 0;
    markers = [];
    saveMarkers();
    curve.set(history, markers);
    totalMoves = 0;
    void forgetBrain();
    flash($("exp-reset"));
  };
  play.addEventListener("click", togglePause);
  segs.forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
  dop.addEventListener("click", toggleDopamine);
  $("exp-rewire").addEventListener("click", rewire);
  $("exp-reset").addEventListener("click", reset);
  const about = $<HTMLDialogElement>("about");
  $("about-btn").addEventListener("click", () => about.showModal());
  about.addEventListener("click", (e) => {
    if (e.target === about) about.close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || about.open) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePause();
    } else if (e.code === "KeyF") setSpeed((opts.speed + 1) % (TURBO + 1));
    else if (e.code === "KeyD") toggleDopamine();
    else if (e.code === "KeyR") rewire();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") client.save();
  });
  sync();
}

function resize(): void {
  board.resize();
  futures.resize();
  circuit?.resize();
  curve.resize();
  brain.resize();
}

async function main(): Promise<void> {
  client.onProgress = (stage, frac) => {
    $("loader-stage").textContent = stage;
    $("loader-bar").style.width = `${Math.round(frac * 100)}%`;
  };
  client.onError = (msg) => {
    $("loader-stage").textContent = `Error: ${msg}`;
    loader.classList.add("error");
  };
  client.onStep = onStep;
  client.onTurbo = onTurbo;
  client.onSaved = (b) => void storeBrain(b);
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  const saved = await loadBrain();
  // the worker resolves URLs against its own script, so hand it an absolute base
  info = await client.init(base, saved);
  addRecords(info.history);
  totalMoves = info.totalMoves;
  game = history.length + 1;
  await Promise.race([
    Promise.all([
      document.fonts.load('500 20px "Newsreader"'),
      document.fonts.load('italic 500 20px "Newsreader"'),
      document.fonts.load('600 20px "IBM Plex Sans"'),
      document.fonts.load('500 12px "IBM Plex Mono"'),
    ]),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  circuit = new CircuitView($<HTMLCanvasElement>("circuit"), info);
  bindUi();
  resize();
  window.addEventListener("resize", resize);
  curve.set(history, markers);
  void brain.load(base, info).catch(() => ($("brain-caption").textContent = "The whole-brain map could not be loaded."));
  loader.classList.add("done");
  if (import.meta.env.DEV) Object.assign(window, { __fly: { client, board, opts, history, info } });
  requestAnimationFrame(tick);
}

void main();
