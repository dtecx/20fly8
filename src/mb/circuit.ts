// The mushroom-body circuit as cut out of FlyWire v783 by scripts/build_data.py, unpacked into typed arrays.

/** mb.json as written by scripts/build_data.py */
export interface CircuitJson {
  version: number;
  dataset: string;
  neurons: number;
  connections: number;
  synapses: number;
  groups: Record<"pn" | "kc" | "mbon" | "dan" | "apl" | "dpm", GroupJson>;
  edges: Record<"pnKc" | "kcMbon" | "danMbon" | "mbonDan" | "danKc" | "kcApl" | "aplKc", number[]>;
  brain: { file: string; scale: number; centre: number[]; superclasses: string[] };
}

interface GroupJson {
  /** index into the 138,639 neurons of the whole brain */
  id: number[];
  type: string[];
  side: string;
  nt: string[];
  /** soma position, micrometres, xyz interleaved */
  pos: number[];
}

export interface Group {
  n: number;
  id: Int32Array;
  type: string[];
  /** 0 = left, 1 = right, 2 = centre/unknown */
  side: Uint8Array;
  nt: string[];
  pos: Float32Array;
}

/** Compressed sparse rows: the targets of source i are tgt[ptr[i] .. ptr[i+1]) with `syn` synapses each. */
export interface Csr {
  ptr: Int32Array;
  tgt: Int32Array;
  syn: Float32Array;
}

/**
 * What a dopamine neuron cluster does to the synapses it modulates: PAM neurons signal reward, PPL1 neurons
 * punishment. Their output neurons promote the opposite: an MBON in a PAM compartment promotes avoidance (reward
 * learning weakens it), an MBON in a PPL1 compartment promotes approach (punishment learning weakens it).
 */
export const PAM = -1;
export const PPL1 = 1;

/**
 * Lobe compartment of each MBON type (hemibrain names, Aso et al. 2014 eLife 3:e04577; Li et al. 2020 eLife
 * 9:e62576). Only used to draw the circuit; the model reads the compartment's dopamine cluster from the wiring.
 */
export const MBON_COMPARTMENT: Record<string, string> = {
  MBON01: "γ5β'2a",
  MBON02: "β2β'2a",
  MBON03: "β'2mp",
  MBON04: "β'2mp",
  MBON05: "γ4>γ1γ2",
  MBON06: "β1>α",
  MBON07: "α1",
  MBON09: "γ3β'1",
  MBON10: "β'1",
  MBON11: "γ1pedc>α/β",
  MBON12: "γ2α'1",
  MBON13: "α'2",
  MBON14: "α3",
  MBON15: "α'1",
  "MBON15-like": "α'1",
  MBON16: "α'3",
  MBON17: "α'3",
  "MBON17-like": "α'3",
  MBON18: "α2sc",
  MBON19: "α2p3p",
  MBON20: "γ1γ2",
  MBON21: "γ4γ5",
  MBON22: "calyx",
  MBON23: "α2sp",
  MBON24: "β2γ5",
  "MBON25,MBON34": "γ1γ2",
  MBON26: "β'2d",
  MBON27: "γ5d",
  MBON28: "α'3",
  MBON29: "γ4γ5",
  MBON30: "γ1γ2γ3",
  MBON31: "α'1",
  MBON32: "γ2",
  MBON33: "γ2γ3",
  MBON35: "γ2",
};

/** Lobe compartment innervated by each dopaminergic type (same sources). */
export const DAN_COMPARTMENT: Record<string, string> = {
  PAM01: "γ5",
  PAM02: "β'2a",
  PAM03: "β2β'2a",
  PAM04: "β2",
  PAM05: "β'2p",
  PAM06: "β'2m",
  PAM07: "γ4<γ1γ2",
  PAM08: "γ4",
  PAM09: "β1ped",
  PAM10: "β1",
  PAM11: "α1",
  PAM12: "γ3",
  PAM13: "β'1ap",
  PAM14: "β'1m",
  PAM15: "γ5β'2a",
  PPL101: "γ1pedc",
  PPL102: "γ1",
  PPL103: "γ2α'1",
  PPL104: "α'3",
  PPL105: "α'2α2",
  PPL106: "α3",
};

/** Kenyon cell lobe system: γ, α/β or α'/β' */
export const LOBE_GAMMA = 0;
export const LOBE_AB = 1;
export const LOBE_APBP = 2;
export const LOBE_NAMES = ["γ", "α/β", "α'/β'"] as const;

export function kcLobe(type: string): number {
  if (type.startsWith("KCg")) return LOBE_GAMMA;
  if (type.startsWith("KCab")) return LOBE_AB;
  return LOBE_APBP;
}

export interface Circuit {
  meta: { dataset: string; neurons: number; connections: number; synapses: number };
  pn: Group;
  kc: Group & { lobe: Uint8Array };
  mbon: Group & {
    /** dopamine cluster of the compartment: PAM (-1), PPL1 (+1) or neither (0), read from DAN->MBON synapses */
    cluster: Int8Array;
    /** most strongly connected dopaminergic type */
    dan: string[];
  };
  dan: Group & { cluster: Int8Array };
  apl: Group;
  dpm: Group;
  /** PN -> KC by PN */
  pnKc: Csr;
  /** KC -> MBON by KC */
  kcMbon: Csr;
  /** MBON -> DAN by MBON (signed synapse counts) */
  mbonDan: Csr;
  brain: CircuitJson["brain"];
}

function group(g: GroupJson): Group {
  return {
    n: g.id.length,
    id: Int32Array.from(g.id),
    type: g.type,
    side: Uint8Array.from(g.side, (c) => (c === "L" ? 0 : c === "R" ? 1 : 2)),
    nt: g.nt,
    pos: Float32Array.from(g.pos),
  };
}

function csr(flat: number[], nSrc: number): Csr {
  const m = flat.length / 3;
  const ptr = new Int32Array(nSrc + 1);
  for (let e = 0; e < m; e++) ptr[flat[3 * e] + 1]++;
  for (let i = 0; i < nSrc; i++) ptr[i + 1] += ptr[i];
  const at = ptr.slice(0, nSrc);
  const tgt = new Int32Array(m);
  const syn = new Float32Array(m);
  for (let e = 0; e < m; e++) {
    const k = at[flat[3 * e]]++;
    tgt[k] = flat[3 * e + 1];
    syn[k] = flat[3 * e + 2];
  }
  return { ptr, tgt, syn };
}

const danCluster = (type: string) => (type.startsWith("PAM") ? PAM : type.startsWith("PPL1") ? PPL1 : 0);

export function parseCircuit(json: CircuitJson): Circuit {
  const g = json.groups;
  const pn = group(g.pn);
  const kcG = group(g.kc);
  const mbonG = group(g.mbon);
  const danG = group(g.dan);
  const dan = { ...danG, cluster: Int8Array.from(danG.type, danCluster) };

  // compartment of each MBON type: whichever dopamine cluster sends it at least twice as many synapses
  const byType = new Map<string, { pam: number; ppl1: number; types: Map<string, number> }>();
  const de = json.edges.danMbon;
  for (let e = 0; e < de.length; e += 3) {
    const d = de[e];
    const t = mbonG.type[de[e + 1]];
    const s = Math.abs(de[e + 2]);
    const rec = byType.get(t) ?? { pam: 0, ppl1: 0, types: new Map<string, number>() };
    if (dan.cluster[d] === PAM) rec.pam += s;
    else if (dan.cluster[d] === PPL1) rec.ppl1 += s;
    rec.types.set(dan.type[d], (rec.types.get(dan.type[d]) ?? 0) + s);
    byType.set(t, rec);
  }
  const cluster = new Int8Array(mbonG.n);
  const topDan: string[] = [];
  for (let m = 0; m < mbonG.n; m++) {
    const rec = byType.get(mbonG.type[m]);
    if (rec && rec.pam >= 2 * rec.ppl1 && rec.pam >= 20) cluster[m] = PAM;
    else if (rec && rec.ppl1 >= 2 * rec.pam && rec.ppl1 >= 20) cluster[m] = PPL1;
    topDan.push(rec ? [...rec.types].sort((a, b) => b[1] - a[1])[0][0] : "");
  }

  return {
    meta: { dataset: json.dataset, neurons: json.neurons, connections: json.connections, synapses: json.synapses },
    pn,
    kc: { ...kcG, lobe: Uint8Array.from(kcG.type, kcLobe) },
    mbon: { ...mbonG, cluster, dan: topDan },
    dan,
    apl: group(g.apl),
    dpm: group(g.dpm),
    pnKc: csr(json.edges.pnKc, pn.n),
    kcMbon: csr(json.edges.kcMbon, kcG.n),
    mbonDan: csr(json.edges.mbonDan, mbonG.n),
    brain: json.brain,
  };
}
