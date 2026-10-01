import "./style.css";
import { type Move } from "./game/board.ts";
import { PaperRenderer, type Timing } from "./game/render.ts";
import type { GameRecord } from "./mb/agent.ts";
import { forgetBrain, loadBrain, MbClient, storeBrain } from "./mb/client.ts";
import type { ReadyInfo, StepFrame, TurboFrame } from "./mb/protocol.ts";

/** watch speeds: how long the fly sniffs, slides and pops per move (ms) */
const SPEEDS: { label: string; timing: Timing; rest: number }[] = [
  { label: "×1", timing: { sniff: 420, slide: 130, pop: 120 }, rest: 90 },
  { label: "×4", timing: { sniff: 100, slide: 60, pop: 50 }, rest: 10 },
  { label: "×16", timing: { sniff: 0, slide: 30, pop: 20 }, rest: 0 },
];
const TURBO = SPEEDS.length;
const GAME_OVER_MS = 1600;
const SAVE_EVERY_MS = 20_000;
const BEST_KEY = "20fly8:best";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const loader = $("loader");
const loaderBar = $("loader-bar");
const loaderStage = $("loader-stage");
const paper = new PaperRenderer($<HTMLCanvasElement>("game"));
const client = new MbClient();

const opts = { speed: 0, paused: false, noDopamine: false };
let info: ReadyInfo;
const history: GameRecord[] = [];
let score = 0;
let game = 1;
let best = 0;
let totalMoves = 0;
let plastic = 0;
let gameOverUntil = 0;
let gameOver = false;
let proboscis = 0;
let startle = 0;
let lastNow = performance.now();
let lastSave = performance.now();
const rate: { t: number; moves: number }[] = [];

try {
  best = Number(localStorage.getItem(BEST_KEY)) || 0;
} catch {
  best = 0;
}

function addRecords(recs: GameRecord[]): void {
  for (const r of recs) {
    history.push(r);
    if (r.score > best) best = r.score;
  }
  if (recs.length) {
    paper.setHistory(history);
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      /* not persisted */
    }
  }
}

function onStep(f: StepFrame): void {
  const now = performance.now();
  const sp = SPEEDS[Math.min(opts.speed, SPEEDS.length - 1)];
  paper.setOptions(f.options, f.move as Move, now);
  paper.playMove(f.before, f.move as Move, f.board, f.spawnCell, sp.timing, now);
  score = f.score;
  game = f.game;
  totalMoves = f.totalMoves;
  plastic = f.plastic;
  if (score > best) best = score;
  if (f.sugar > 0) proboscis = Math.min(1, 0.45 + 0.25 * f.sugar);
  gameOver = f.gameOver;
  if (f.record) {
    addRecords([f.record]);
    startle = 1;
    gameOverUntil = now + paper.busyFor(now) + GAME_OVER_MS;
  }
  rate.push({ t: now, moves: totalMoves });
}

function onTurbo(f: TurboFrame): void {
  const now = performance.now();
  paper.setBoard(f.board);
  paper.setOptions(null, -1, now);
  score = f.score;
  game = f.game;
  totalMoves = f.totalMoves;
  plastic = f.plastic;
  gameOver = false;
  addRecords(f.records);
  rate.push({ t: now, moves: totalMoves });
}

function updateNums(): void {
  while (rate.length > 2 && rate[rate.length - 1].t - rate[0].t > 2000) rate.shift();
  const r0 = rate[0];
  const r1 = rate[rate.length - 1];
  const mps = r0 && r1 && r1.t > r0.t ? ((r1.moves - r0.moves) * 1000) / (r1.t - r0.t) : 0;
  const last = history.slice(-100);
  const mean = last.length ? last.reduce((s, g) => s + g.score, 0) / last.length : 0;
  const reach = (e: number) => (last.length ? Math.round((100 * last.filter((g) => g.maxTile >= e).length) / last.length) : 0);
  const bestTile = history.reduce((m, g) => Math.max(m, g.maxTile), 0);
  $("n-games").textContent = history.length.toLocaleString("en-US");
  $("n-moves").textContent = totalMoves.toLocaleString("en-US");
  $("n-mean").textContent = last.length ? Math.round(mean).toLocaleString("en-US") : "—";
  $("n-best").textContent = bestTile ? String(2 ** bestTile) : "—";
  $("n-plastic").textContent = `${plastic.toLocaleString("en-US")} (${((100 * plastic) / Math.max(1, info.kcMbonConnections)).toFixed(1)}%)`;
  $("n-speed").textContent = mps >= 100 ? Math.round(mps).toLocaleString("en-US") : mps.toFixed(1);
  $("n-reach").textContent = last.length ? `512: ${reach(9)}%   1024: ${reach(10)}%   2048: ${reach(11)}%` : "—";
}

function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  const turbo = opts.speed === TURBO;
  if (!opts.paused && !turbo && !client.pending && now >= gameOverUntil) {
    const sp = SPEEDS[opts.speed];
    if (paper.busyFor(now) <= 0 && now - lastStepAt >= sp.rest) {
      lastStepAt = now;
      client.step();
    }
  }
  proboscis *= Math.exp(-dt / 0.35);
  startle *= Math.exp(-dt / 0.5);
  paper.draw(now, dt, {
    score,
    best,
    game,
    turbo,
    paused: opts.paused,
    learning: !opts.noDopamine,
    proboscis,
    startle,
    gameOver: gameOver && now < gameOverUntil,
  });
  if (now - numsAt > 200) {
    numsAt = now;
    updateNums();
  }
  if (now - lastSave > SAVE_EVERY_MS) {
    lastSave = now;
    client.save();
  }
  requestAnimationFrame(tick);
}
let lastStepAt = 0;
let numsAt = 0;

function bindUi(): void {
  const sync = () => {
    $("speed-btn").textContent = opts.speed === TURBO ? "turbo" : SPEEDS[opts.speed].label;
    $("speed-btn").classList.toggle("on", opts.speed === TURBO);
    $("pause-btn").textContent = opts.paused ? "▶ resume" : "❚❚ pause";
    $("pause-btn").classList.toggle("on", opts.paused);
    document.querySelector('[data-opt="noDopamine"]')!.classList.toggle("on", opts.noDopamine);
  };
  const setSpeed = (s: number) => {
    const wasTurbo = opts.speed === TURBO;
    opts.speed = s;
    const turbo = s === TURBO;
    if (turbo !== wasTurbo) client.turbo(turbo && !opts.paused);
    sync();
  };
  const cycleSpeed = () => setSpeed((opts.speed + 1) % (TURBO + 1));
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
  const flash = (id: string) => {
    $(id).classList.add("flash");
    setTimeout(() => $(id).classList.remove("flash"), 400);
  };
  const shuffle = () => {
    client.shuffle((Math.random() * 2 ** 31) | 0);
    flash("shuffle-btn");
  };
  const reset = () => {
    if (!confirm("Start over with a naive fly? Everything this one learned is forgotten.")) return;
    client.reset();
    history.length = 0;
    paper.setHistory(history);
    totalMoves = 0;
    void forgetBrain();
    flash("reset-btn");
  };
  $("speed-btn").addEventListener("click", cycleSpeed);
  $("pause-btn").addEventListener("click", togglePause);
  document.querySelector('[data-opt="noDopamine"]')!.addEventListener("click", toggleDopamine);
  $("shuffle-btn").addEventListener("click", shuffle);
  $("reset-btn").addEventListener("click", reset);
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePause();
    } else if (e.code === "KeyF") cycleSpeed();
    else if (e.code === "KeyD") toggleDopamine();
    else if (e.code === "KeyS") shuffle();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") client.save();
  });
  sync();
}

async function main(): Promise<void> {
  paper.resize();
  client.onProgress = (stage, frac) => {
    loaderStage.textContent = stage;
    loaderBar.style.width = `${Math.round(frac * 100)}%`;
  };
  client.onError = (msg) => {
    loaderStage.textContent = `Error: ${msg}`;
    loader.classList.add("error");
  };
  client.onStep = onStep;
  client.onTurbo = onTurbo;
  client.onSaved = (brain) => void storeBrain(brain);
  const saved = await loadBrain();
  // the worker resolves URLs against its own script, so hand it an absolute base
  info = await client.init(new URL(import.meta.env.BASE_URL, location.href).href, saved);
  addRecords(info.history);
  totalMoves = info.totalMoves;
  game = history.length + 1;
  await Promise.race([
    Promise.all([document.fonts.load("40px Pangolin"), document.fonts.load('12px "JetBrains Mono"')]),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  $("dataset").textContent =
    `${info.dataset} · ${info.kc.n.toLocaleString("en-US")} Kenyon cells · ${info.pn.n} projection neurons · ` +
    `${info.mbon.n} output neurons · ${info.kcMbonConnections.toLocaleString("en-US")} plastic synapses`;
  bindUi();
  paper.resize();
  window.addEventListener("resize", () => paper.resize());
  loader.classList.add("done");
  if (import.meta.env.DEV) Object.assign(window, { __fly: { client, paper, opts, history, info } });
  lastNow = performance.now();
  requestAnimationFrame(tick);
}

void main();
