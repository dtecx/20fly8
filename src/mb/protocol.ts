// Messages between the page and the mushroom-body worker.
import type { GameRecord } from "./agent.ts";
import type { ModelParams } from "./model.ts";

export interface ReadyInfo {
  dataset: string;
  neurons: number;
  connections: number;
  synapses: number;
  pn: { n: number; type: string[]; side: Uint8Array };
  kc: { n: number; type: string[]; side: Uint8Array; lobe: Uint8Array };
  mbon: { n: number; type: string[]; side: Uint8Array; cluster: Int8Array; dan: string[] };
  dan: { n: number; type: string[]; side: Uint8Array; cluster: Int8Array };
  /** PN -> KC and KC -> MBON connection and synapse counts */
  pnKcConnections: number;
  pnKcSynapses: number;
  kcMbonConnections: number;
  kcMbonSynapses: number;
  params: ModelParams;
  /** PN index of every (side, cell, level) smell */
  nose: Int32Array[];
  noseSeed: number;
  /** restored from a saved brain */
  history: GameRecord[];
  totalMoves: number;
  loadMs: number;
}

export interface OptionView {
  legal: boolean;
  sugar: number;
  points: number;
  valence: number;
  worth: number;
  /** active KCs per lobe system (γ, α/β, α'/β') */
  kcByLobe: [number, number, number];
  kcActive: number;
  /** drive into approach (PPL1-compartment) and avoidance (PAM-compartment) MBONs */
  approach: number;
  avoid: number;
}

/** one move, in detail (watch mode) */
export interface StepFrame {
  id: number;
  move: number;
  before: Uint8Array;
  board: Uint8Array;
  spawnCell: number;
  options: OptionView[];
  /** KCs active for the chosen board */
  kcs: Int32Array;
  /** PNs on for the chosen board */
  pns: Int32Array;
  /** drive of every MBON for the chosen board */
  mbon: Float32Array;
  sugar: number;
  points: number;
  dopamine: number;
  synapsesChanged: number;
  score: number;
  moves: number;
  game: number;
  gameOver: boolean;
  record: GameRecord | null;
  totalMoves: number;
  /** synapses whose strength differs from the connectome's */
  plastic: number;
  wallMs: number;
}

/** many moves, summarised (turbo mode) */
export interface TurboFrame {
  board: Uint8Array;
  score: number;
  moves: number;
  game: number;
  records: GameRecord[];
  /** sampled reward-prediction errors since the last frame */
  dopamine: Float32Array;
  movesDone: number;
  wallMs: number;
  totalMoves: number;
  plastic: number;
}

export type ToWorker =
  | { type: "init"; base: string; gains: ArrayBuffer | null; history: GameRecord[]; totalMoves: number; noseSeed: number }
  | { type: "step"; id: number }
  | { type: "turbo"; on: boolean }
  | { type: "learning"; on: boolean }
  | { type: "shuffle"; seed: number }
  | { type: "reset" }
  | { type: "save" };

export type FromWorker =
  | { type: "progress"; stage: string; frac: number }
  | { type: "ready"; info: ReadyInfo }
  | { type: "step"; frame: StepFrame }
  | { type: "turbo"; frame: TurboFrame }
  | { type: "saved"; gains: ArrayBuffer; history: GameRecord[]; totalMoves: number; noseSeed: number }
  | { type: "nose"; nose: Int32Array[]; noseSeed: number }
  | { type: "error"; message: string };
