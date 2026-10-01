// Headless training: the mushroom body plays game after game and learns from dopamine.
//   node scripts/train.ts [--games 2000] [--report 250] [--seed 1] [--no-dopamine] [--save public/data/trained.bin]
//                         [--alpha 0.1] [--gamma 0.99] [--sparseness 0.1]
import { readFileSync, writeFileSync } from "node:fs";
import { FlyAgent } from "../src/mb/agent.ts";
import { parseCircuit, type CircuitJson } from "../src/mb/circuit.ts";
import { MushroomBody, type ModelParams } from "../src/mb/model.ts";

const arg = (name: string, def: string) => {
  const i = process.argv.lastIndexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const circuit = parseCircuit(JSON.parse(readFileSync(new URL("../public/data/mb.json", import.meta.url), "utf8")) as CircuitJson);
const params: Partial<ModelParams> = {};
for (const k of ["alpha", "gamma", "sparseness", "synScale", "gainMax"] as const) if (process.argv.includes(`--${k}`)) params[k] = Number(arg(k, "0"));
const mb = new MushroomBody(circuit, params);
const agent = new FlyAgent(mb, Number(arg("seed", "1")));
agent.learning = !flag("no-dopamine");
const games = Number(arg("games", "2000"));
const report = Number(arg("report", "250"));

console.log(
  `${circuit.kc.n} KCs, ${circuit.pn.n} PNs, ${circuit.mbon.n} MBONs (${[...circuit.mbon.cluster].filter((c) => c === 1).length} approach, ` +
    `${[...circuit.mbon.cluster].filter((c) => c === -1).length} avoidance), ${mb.gain.length} plastic synapses; ` +
    `dopamine ${agent.learning ? "on" : "OFF"}; ${JSON.stringify(mb.p)}`,
);
const t0 = performance.now();
let from = 0;
while (agent.history.length < games) {
  const r = agent.step();
  if (!r.gameOver) continue;
  agent.newGame();
  const n = agent.history.length;
  if (n % report === 0) {
    const win = agent.history.slice(from);
    from = n;
    const mean = win.reduce((s, g) => s + g.score, 0) / win.length;
    const moves = win.reduce((s, g) => s + g.moves, 0) / win.length;
    const tiles = new Map<number, number>();
    for (const g of win) tiles.set(g.maxTile, (tiles.get(g.maxTile) ?? 0) + 1);
    const pct = (e: number) => ((100 * win.filter((g) => g.maxTile >= e).length) / win.length).toFixed(0).padStart(3);
    const sec = (performance.now() - t0) / 1000;
    console.log(
      `games ${String(n).padStart(5)} | mean score ${mean.toFixed(0).padStart(6)} | moves ${moves.toFixed(0).padStart(4)} | ` +
        `≥512 ${pct(9)}% ≥1024 ${pct(10)}% ≥2048 ${pct(11)}% | best ${[...tiles.keys()].map((e) => 1 << e).sort((a, b) => b - a)[0]} | ` +
        `${sec.toFixed(0)} s, ${(agent.totalMoves / sec / 1000).toFixed(1)}k moves/s`,
    );
  }
}
const save = arg("save", "");
if (save) {
  writeFileSync(save, Buffer.from(mb.gain.buffer, mb.gain.byteOffset, mb.gain.byteLength));
  console.log(`saved ${mb.gain.length} synapse gains to ${save}`);
}
