// Is it really learning? Controls, each played with the synapses frozen (no dopamine) unless noted.
//   node scripts/eval.ts [--train 2000] [--games 500] [--seed 1]
//
//   random moves             a uniformly random legal move
//   naive fly                the connectome's synapses, never changed
//   trained fly              after --train games with dopamine
//   trained, nose rewired    every smell now reaches different projection neurons
//   trained, synapses mixed  the learned KC->MBON strengths shuffled among the synapses
import { readFileSync } from "node:fs";
import { canMove, MOVES, newBoard, Rng, slide, spawnTile, maxTile } from "../src/game/board.ts";
import { FlyAgent } from "../src/mb/agent.ts";
import { parseCircuit, type CircuitJson } from "../src/mb/circuit.ts";
import { MushroomBody } from "../src/mb/model.ts";

const arg = (name: string, def: string) => {
  const i = process.argv.lastIndexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const TRAIN = Number(arg("train", "2000"));
const GAMES = Number(arg("games", "500"));
const SEED = Number(arg("seed", "1"));

const circuit = parseCircuit(JSON.parse(readFileSync(new URL("../public/data/mb.json", import.meta.url), "utf8")) as CircuitJson);

interface Result {
  label: string;
  scores: number[];
  tiles: number[];
}

function summary(r: Result): string {
  const n = r.scores.length;
  const mean = r.scores.reduce((a, b) => a + b, 0) / n;
  const sorted = [...r.scores].sort((a, b) => a - b);
  const pct = (e: number) => `${Math.round((100 * r.tiles.filter((t) => t >= e).length) / n)}%`.padStart(5);
  return `${r.label.padEnd(26)} ${String(Math.round(mean)).padStart(7)} ${String(sorted[n >> 1]).padStart(7)}  ${pct(8)} ${pct(9)} ${pct(10)} ${pct(11)}   ${2 ** Math.max(...r.tiles)}`;
}

function randomPlay(games: number, seed: number): Result {
  const rng = new Rng(seed);
  const out: Result = { label: "random moves", scores: [], tiles: [] };
  for (let g = 0; g < games; g++) {
    let b = newBoard(rng);
    let score = 0;
    while (canMove(b)) {
      const legal = MOVES.filter((m) => slide(b, m).moved);
      const r = slide(b, legal[rng.int(legal.length)]);
      score += r.score;
      b = r.board;
      spawnTile(b, rng);
    }
    out.scores.push(score);
    out.tiles.push(maxTile(b));
  }
  return out;
}

function play(agent: FlyAgent, games: number, label: string): Result {
  const from = agent.history.length;
  while (agent.history.length - from < games) {
    if (agent.step().gameOver) agent.newGame();
  }
  const recs = agent.history.slice(from);
  return { label, scores: recs.map((g) => g.score), tiles: recs.map((g) => g.maxTile) };
}

const t0 = performance.now();
const log = (s: string) => console.log(`${s}  (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
const results: Result[] = [];

results.push(randomPlay(GAMES * 2, SEED));
log("random moves done");

const naive = new FlyAgent(new MushroomBody(circuit), SEED + 1);
naive.learning = false;
results.push(play(naive, GAMES, "naive fly (no dopamine)"));
log("naive fly done");

const mb = new MushroomBody(circuit);
const learner = new FlyAgent(mb, SEED + 2);
const curve: number[] = [];
for (let g = 0; g < TRAIN; g += 250) {
  const r = play(learner, Math.min(250, TRAIN - g), "");
  curve.push(Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length));
}
log(`trained ${TRAIN} games; mean score per 250: ${curve.join(" → ")}`);
const trained = mb.gain.slice();

learner.learning = false;
results.push(play(learner, GAMES, `trained fly (${TRAIN} games)`));
log("trained fly done");

mb.setNose(SEED + 12345);
results.push(play(learner, GAMES, "trained, nose rewired"));
log("rewired nose done");

mb.setNose(2048);
const rng = new Rng(SEED + 99);
const mixed = trained.slice();
for (let i = mixed.length - 1; i > 0; i--) {
  const j = rng.int(i + 1);
  [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
}
mb.loadGains(mixed);
results.push(play(learner, GAMES, "trained, synapses mixed"));
log("mixed synapses done");

console.log(`\n${"condition".padEnd(26)} ${"mean".padStart(7)} ${"median".padStart(7)}  ${"≥256".padStart(5)} ${"≥512".padStart(5)} ${"≥1024".padStart(5)} ${"≥2048".padStart(5)}   best`);
for (const r of results) console.log(summary(r));
