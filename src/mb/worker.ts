// Runs the mushroom body and the game off the main thread.
import { FlyAgent, type GameRecord } from "./agent.ts";
import { parseCircuit, type Circuit, type CircuitJson } from "./circuit.ts";
import { MushroomBody } from "./model.ts";
import type { FromWorker, OptionView, ToWorker } from "./protocol.ts";

interface WorkerScope {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

/** turbo: play for this long, then report and yield to incoming messages */
const SLICE_MS = 24;
const MAX_DOPAMINE_SAMPLES = 240;

let circuit: Circuit;
let mb: MushroomBody;
let agent: FlyAgent;
let noseSeed = 2048;
let turbo = false;
let turboTimer: ReturnType<typeof setTimeout> | null = null;
let reported = 0;
const mbonDrive = new Float32Array(256);

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) post({ type: "progress", stage: "Downloading the mushroom body", frac: 0.05 + (0.75 * got) / total });
  }
  return JSON.parse(await new Blob(chunks as BlobPart[]).text());
}

function countPlastic(): number {
  let n = 0;
  const g = mb.gain;
  for (let e = 0; e < g.length; e++) if (g[e] !== 1) n++;
  return n;
}

async function init(msg: Extract<ToWorker, { type: "init" }>): Promise<void> {
  const t0 = performance.now();
  post({ type: "progress", stage: "Downloading the mushroom body", frac: 0.02 });
  const json = (await fetchJson(`${msg.base}data/mb.json`)) as CircuitJson;
  post({ type: "progress", stage: "Wiring 5,177 Kenyon cells", frac: 0.85 });
  circuit = parseCircuit(json);
  noseSeed = msg.noseSeed;
  mb = new MushroomBody(circuit, {}, noseSeed);
  if (msg.gains) {
    try {
      mb.loadGains(new Float32Array(msg.gains));
    } catch {
      msg.history = [];
      msg.totalMoves = 0;
    }
  }
  agent = new FlyAgent(mb, (Math.random() * 2 ** 31) | 0);
  agent.history.push(...msg.history);
  agent.game = msg.history.length + 1;
  agent.totalMoves = msg.totalMoves;
  reported = agent.history.length;

  const sum = (a: Float32Array) => a.reduce((s, x) => s + x, 0);
  post({
    type: "ready",
    info: {
      dataset: circuit.meta.dataset,
      neurons: circuit.meta.neurons,
      connections: circuit.meta.connections,
      synapses: circuit.meta.synapses,
      pn: { n: circuit.pn.n, type: circuit.pn.type, side: circuit.pn.side },
      kc: { n: circuit.kc.n, type: circuit.kc.type, side: circuit.kc.side, lobe: circuit.kc.lobe },
      mbon: { n: circuit.mbon.n, type: circuit.mbon.type, side: circuit.mbon.side, cluster: circuit.mbon.cluster, dan: circuit.mbon.dan },
      dan: { n: circuit.dan.n, type: circuit.dan.type, side: circuit.dan.side, cluster: circuit.dan.cluster },
      pnKcConnections: circuit.pnKc.tgt.length,
      pnKcSynapses: sum(circuit.pnKc.syn),
      kcMbonConnections: circuit.kcMbon.tgt.length,
      kcMbonSynapses: sum(circuit.kcMbon.syn),
      params: { ...mb.p },
      nose: mb.nose,
      noseSeed,
      history: agent.history,
      totalMoves: agent.totalMoves,
      loadMs: performance.now() - t0,
    },
  });
}

function view(o: FlyAgent["options"][number]): OptionView {
  const byLobe: [number, number, number] = [0, 0, 0];
  let approach = 0;
  let avoid = 0;
  const km = circuit.kcMbon;
  const cl = circuit.mbon.cluster;
  for (let i = 0; i < o.code.n; i++) {
    const k = o.code.k[i];
    byLobe[circuit.kc.lobe[k]]++;
    const a = o.code.a[i];
    for (let e = km.ptr[k]; e < km.ptr[k + 1]; e++) {
      const c = cl[km.tgt[e]];
      if (c > 0) approach += km.syn[e] * mb.gain[e] * a;
      else if (c < 0) avoid += km.syn[e] * mb.gain[e] * a;
    }
  }
  const norm = o.code.z > 0 ? mb.p.synScale / Math.sqrt(o.code.z) : 0;
  return {
    legal: o.legal,
    sugar: o.sugar,
    points: o.points,
    valence: o.valence,
    worth: o.legal ? o.worth : 0,
    kcByLobe: byLobe,
    kcActive: o.code.n,
    approach: approach * norm,
    avoid: avoid * norm,
  };
}

function newRecords(): GameRecord[] {
  const out = agent.history.slice(reported);
  reported = agent.history.length;
  return out;
}

function step(id: number): void {
  const t0 = performance.now();
  const r = agent.step();
  // the options were evaluated on the board before the move: report them as the fly saw them
  const options = agent.options.map(view);
  const chosen = agent.options[r.move].code;
  mb.mbonDrive(chosen, mbonDrive);
  const kcs = chosen.k.slice(0, chosen.n);
  const pns = mb.pnsOf(agent.options[r.move].after);
  const record = r.gameOver ? agent.history[agent.history.length - 1] : null;
  if (record) reported = agent.history.length;
  const frame = {
    id,
    move: r.move,
    before: r.before,
    board: r.board.slice(),
    spawnCell: r.spawnCell,
    options,
    kcs,
    pns,
    mbon: mbonDrive.slice(0, circuit.mbon.n),
    sugar: r.sugar,
    points: r.points,
    dopamine: r.dopamine,
    synapsesChanged: r.synapsesChanged,
    score: agent.score,
    moves: agent.moves,
    game: agent.game,
    gameOver: r.gameOver,
    record,
    totalMoves: agent.totalMoves,
    plastic: countPlastic(),
    wallMs: performance.now() - t0,
  };
  post({ type: "step", frame }, [frame.kcs.buffer, frame.pns.buffer, frame.mbon.buffer]);
}

function turboSlice(): void {
  turboTimer = null;
  if (!turbo) return;
  const t0 = performance.now();
  const dop: number[] = [];
  let n = 0;
  while (performance.now() - t0 < SLICE_MS) {
    for (let k = 0; k < 32; k++) {
      const r = agent.step();
      n++;
      if (r.dopamine !== 0) dop.push(r.dopamine);
      if (r.gameOver) agent.newGame();
    }
  }
  const stride = Math.max(1, Math.ceil(dop.length / MAX_DOPAMINE_SAMPLES));
  const sample = new Float32Array(Math.ceil(dop.length / stride));
  for (let i = 0; i < sample.length; i++) sample[i] = dop[i * stride];
  const frame = {
    board: agent.board.slice(),
    score: agent.score,
    moves: agent.moves,
    game: agent.game,
    records: newRecords(),
    dopamine: sample,
    movesDone: n,
    wallMs: performance.now() - t0,
    totalMoves: agent.totalMoves,
    plastic: countPlastic(),
  };
  post({ type: "turbo", frame }, [frame.board.buffer, frame.dopamine.buffer]);
  turboTimer = setTimeout(turboSlice, 0);
}

scope.onmessage = (ev) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init":
        void init(msg).catch((err) => post({ type: "error", message: String(err?.stack ?? err) }));
        break;
      case "step":
        step(msg.id);
        break;
      case "turbo":
        turbo = msg.on;
        if (turbo && !turboTimer) turboTimer = setTimeout(turboSlice, 0);
        break;
      case "learning":
        agent.learning = msg.on;
        break;
      case "shuffle":
        noseSeed = msg.seed;
        mb.setNose(noseSeed);
        post({ type: "nose", nose: mb.nose, noseSeed });
        break;
      case "reset":
        mb.resetSynapses();
        agent.history.length = 0;
        reported = 0;
        agent.totalMoves = 0;
        agent.game = 0;
        agent.newGame();
        break;
      case "save": {
        const gains = mb.gain.slice().buffer;
        post({ type: "saved", gains, history: agent.history, totalMoves: agent.totalMoves, noseSeed }, [gains]);
        break;
      }
    }
  } catch (err) {
    post({ type: "error", message: String((err as Error)?.stack ?? err) });
  }
};
