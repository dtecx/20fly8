// The fly's mushroom body as a rate model on the real FlyWire wiring, with dopamine-gated plasticity.
//
//   board ──"nose"──► projection neurons ──FlyWire synapses──► Kenyon cells ──plastic synapses──► output neurons
//                          (267 PNs)        (27,502 connections)   (5,177; APL keeps   (62,261 connections)  (96 MBONs)
//                                                                   the top 10 % on)
//
// The output neurons sit in compartments of the mushroom-body lobes. Each compartment gets dopamine from one
// cluster: PAM neurons (reward) or PPL1 neurons (punishment). A PAM-compartment MBON promotes avoidance, a
// PPL1-compartment MBON approach, so the fly's attraction to a smell (its "valence") is
//   valence = Σ PPL1-compartment MBON drive − Σ PAM-compartment MBON drive.
// Dopamine changes the synapses from the Kenyon cells that were active (Hige et al. 2015, Neuron 88:985):
// a PAM burst weakens a cell's synapses onto avoidance MBONs, a PPL1 burst its synapses onto approach MBONs, and a
// pause below the tonic rate strengthens them. Driving PAM with the reward-prediction error (and PPL1 with its
// negative) turns this into temporal-difference learning of how good a board smells.

import type { Circuit } from "./circuit.ts";
import { Rng } from "../game/board.ts";

export interface ModelParams {
  /** fraction of each side's Kenyon cells that APL lets fire */
  sparseness: number;
  /** a KC above the APL threshold fires at 0.2 + min(1, gradedGain × excess input fraction); 0 = all-or-none */
  gradedGain: number;
  /** learning rate */
  alpha: number;
  /** discount per move */
  gamma: number;
  /** mV-ish scale of a KC->MBON synapse at its initial strength (1 = connectome count) */
  synScale: number;
  /** a synapse's gain stays in [0, gainMax] (1 = initial connectome strength) */
  gainMax: number;
}

export const DEFAULT_PARAMS: ModelParams = {
  sparseness: 0.1,
  gradedGain: 10,
  alpha: 0.1,
  gamma: 0.99,
  synScale: 0.1,
  gainMax: 8,
};

/** levels of the "smell" of one board cell: empty, or a tile size; each side of the brain reads a different range */
export const LEVELS = 8;
export const SMELL_LABELS: readonly (readonly string[])[] = [
  ["empty", "2", "4", "8", "16", "32", "64", "≥128"],
  ["empty", "2–16", "32", "64", "128", "256", "512", "≥1024"],
];

/** smell level of a tile with exponent `v` (0 = empty) for the left (0) or right (1) antennal lobe */
export function smellLevel(v: number, side: number): number {
  if (v === 0) return 0;
  if (side === 0) return Math.min(7, v);
  return v <= 4 ? 1 : Math.min(7, v - 3);
}

/** KC code of one board: active cell indices and their activity */
export class KcCode {
  readonly k: Int32Array;
  readonly a: Float32Array;
  n = 0;
  /** Σ activity, used to normalise the readout */
  z = 0;
  constructor(cap: number) {
    this.k = new Int32Array(cap);
    this.a = new Float32Array(cap);
  }
  copyFrom(o: KcCode): void {
    this.k.set(o.k.subarray(0, o.n));
    this.a.set(o.a.subarray(0, o.n));
    this.n = o.n;
    this.z = o.z;
  }
}

export class MushroomBody {
  readonly c: Circuit;
  readonly p: ModelParams;
  /** smell map: PN index for [side][cell * LEVELS + level] */
  readonly nose: Int32Array[] = [];
  /** plastic gain of every KC->MBON synapse (same order as circuit.kcMbon), 1 = connectome strength */
  readonly gain: Float32Array;
  /** sign of each KC->MBON synapse's MBON: +1 approach (PPL1 compartment), -1 avoidance (PAM), 0 neither */
  private readonly edgeSign: Int8Array;
  /** net valence weight of each KC (approach minus avoidance synapses), kept in sync with `gain` */
  readonly u: Float32Array;
  /** Σ synapses of each KC onto MBONs with a valence, for the per-synapse learning rate */
  private readonly valSyn: Float32Array;
  private readonly invTotal: Float32Array;
  private readonly kcSide: Uint8Array;
  private readonly nSide: number[] = [0, 0];

  // scratch
  private readonly h: Float32Array;
  private readonly mark: Uint8Array;
  private readonly touched: Int32Array[];
  private readonly nTouched = [0, 0];
  private readonly x: Float32Array;

  /** counts for display: plastic events so far */
  updates = 0;

  constructor(circuit: Circuit, params: Partial<ModelParams> = {}, noseSeed = 2048) {
    this.c = circuit;
    this.p = { ...DEFAULT_PARAMS, ...params };
    const nk = circuit.kc.n;
    // every KC in v783 is left or right; anything else is counted with the left side
    this.kcSide = circuit.kc.side.map((s) => (s === 1 ? 1 : 0));
    for (let k = 0; k < nk; k++) this.nSide[this.kcSide[k]]++;

    const { ptr, syn } = circuit.pnKc;
    const total = new Float32Array(nk);
    for (let j = 0; j < circuit.pn.n; j++) for (let e = ptr[j]; e < ptr[j + 1]; e++) total[circuit.pnKc.tgt[e]] += syn[e];
    this.invTotal = total.map((t) => (t > 0 ? 1 / t : 0));

    const km = circuit.kcMbon;
    this.gain = new Float32Array(km.tgt.length).fill(1);
    this.edgeSign = Int8Array.from(km.tgt, (m) => circuit.mbon.cluster[m]);
    this.u = new Float32Array(nk);
    this.valSyn = new Float32Array(nk);
    for (let k = 0; k < nk; k++) {
      for (let e = km.ptr[k]; e < km.ptr[k + 1]; e++) if (this.edgeSign[e] !== 0) this.valSyn[k] += km.syn[e];
      this.refreshKc(k);
    }

    this.h = new Float32Array(nk);
    this.mark = new Uint8Array(nk);
    this.touched = [new Int32Array(nk), new Int32Array(nk)];
    this.x = new Float32Array(nk);
    this.setNose(noseSeed);
  }

  /** Assign every (cell, level) smell to its own projection neuron on each side, shuffled by `seed`. */
  setNose(seed: number): void {
    const rng = new Rng(seed);
    this.nose.length = 0;
    for (let s = 0; s < 2; s++) {
      const pns: number[] = [];
      for (let j = 0; j < this.c.pn.n; j++) if (this.c.pn.side[j] === s) pns.push(j);
      for (let i = pns.length - 1; i > 0; i--) {
        const r = rng.int(i + 1);
        [pns[i], pns[r]] = [pns[r], pns[i]];
      }
      if (pns.length < 16 * LEVELS) throw new Error(`side ${s}: ${pns.length} PNs for ${16 * LEVELS} smells`);
      this.nose.push(Int32Array.from(pns.slice(0, 16 * LEVELS)));
    }
  }

  /** net valence weight of KC k from its synapses' current gains */
  private refreshKc(k: number): void {
    const km = this.c.kcMbon;
    let v = 0;
    for (let e = km.ptr[k]; e < km.ptr[k + 1]; e++) v += this.edgeSign[e] * km.syn[e] * this.gain[e];
    this.u[k] = v * this.p.synScale;
  }

  /** Smell a board: projection neurons -> Kenyon cells, APL keeps the strongest `sparseness` of each side on. */
  code(board: Uint8Array, out: KcCode): void {
    const { ptr, tgt, syn } = this.c.pnKc;
    const { h, mark, touched, nTouched, invTotal, kcSide } = this;
    nTouched[0] = nTouched[1] = 0;
    for (let s = 0; s < 2; s++) {
      const map = this.nose[s];
      for (let i = 0; i < 16; i++) {
        const j = map[i * LEVELS + smellLevel(board[i], s)];
        for (let e = ptr[j], end = ptr[j + 1]; e < end; e++) {
          const k = tgt[e];
          if (!mark[k]) {
            mark[k] = 1;
            h[k] = 0;
            const sd = kcSide[k];
            touched[sd][nTouched[sd]++] = k;
          }
          h[k] += syn[e];
        }
      }
    }
    out.n = 0;
    out.z = 0;
    const x = this.x;
    const gg = this.p.gradedGain;
    for (let s = 0; s < 2; s++) {
      const T = touched[s];
      const n = nTouched[s];
      const want = Math.max(1, Math.round(this.p.sparseness * this.nSide[s]));
      for (let i = 0; i < n; i++) x[i] = h[T[i]] * invTotal[T[i]];
      const thr = n > want ? kthLargest(x, n, want) : 0;
      for (let i = 0; i < n; i++) {
        const k = T[i];
        const xi = h[k] * invTotal[k];
        if (xi > thr) {
          const a = gg > 0 ? 0.2 + Math.min(1, gg * (xi - thr)) : 1;
          out.k[out.n] = k;
          out.a[out.n++] = a;
          out.z += a;
        }
        mark[k] = 0;
      }
    }
  }

  /** the 32 projection neurons a board turns on (16 cells x 2 sides) */
  pnsOf(board: Uint8Array): Int32Array {
    const out = new Int32Array(32);
    for (let s = 0; s < 2; s++) for (let i = 0; i < 16; i++) out[s * 16 + i] = this.nose[s][i * LEVELS + smellLevel(board[i], s)];
    return out;
  }

  /** valence of a coded smell: approach minus avoidance drive, normalised by the number of active KCs */
  valence(code: KcCode): number {
    let v = 0;
    for (let i = 0; i < code.n; i++) v += this.u[code.k[i]] * code.a[i];
    return code.z > 0 ? v / Math.sqrt(code.z) : 0;
  }

  /**
   * Dopamine: `delta` > 0 is a PAM burst (better than expected), < 0 a PPL1 burst (worse). Every synapse of
   * the Kenyon cells in `code` onto a valenced MBON moves: PAM bursts weaken avoidance synapses, PPL1 bursts weaken
   * approach synapses, and the opposite cluster's pause strengthens its own. Returns the number of synapses changed.
   */
  dopamine(code: KcCode, delta: number): number {
    if (delta === 0 || code.z === 0) return 0;
    const km = this.c.kcMbon;
    const { gain, edgeSign, valSyn } = this;
    const gMax = this.p.gainMax;
    const base = (this.p.alpha * delta) / (Math.sqrt(code.z) * this.p.synScale);
    let changed = 0;
    for (let i = 0; i < code.n; i++) {
      const k = code.k[i];
      if (valSyn[k] === 0) continue;
      const step = (base * code.a[i]) / valSyn[k];
      for (let e = km.ptr[k], end = km.ptr[k + 1]; e < end; e++) {
        const s = edgeSign[e];
        if (s === 0) continue;
        const g = Math.min(gMax, Math.max(0, gain[e] + s * step));
        if (g !== gain[e]) {
          gain[e] = g;
          changed++;
        }
      }
      this.refreshKc(k);
    }
    this.updates++;
    return changed;
  }

  /** MBON drive for a coded smell (for display): Σ active KC synapses × gain, and the same at connectome strength */
  mbonDrive(code: KcCode, out: Float32Array, naive: Float32Array): void {
    out.fill(0);
    naive.fill(0);
    const km = this.c.kcMbon;
    for (let i = 0; i < code.n; i++) {
      const k = code.k[i];
      for (let e = km.ptr[k]; e < km.ptr[k + 1]; e++) {
        const d = km.syn[e] * code.a[i];
        out[km.tgt[e]] += d * this.gain[e];
        naive[km.tgt[e]] += d;
      }
    }
  }

  /** forget everything learned */
  resetSynapses(): void {
    this.gain.fill(1);
    for (let k = 0; k < this.c.kc.n; k++) this.refreshKc(k);
    this.updates = 0;
  }

  loadGains(g: Float32Array): void {
    if (g.length !== this.gain.length) throw new Error("saved synapses do not match this circuit");
    this.gain.set(g);
    for (let k = 0; k < this.c.kc.n; k++) this.refreshKc(k);
  }
}

/** k-th largest (0-based) of a[0..n); reorders a */
function kthLargest(a: Float32Array, n: number, k: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] > pivot) i++;
      while (a[j] < pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}
