// Panel c: the mushroom body as a live drawing. The chosen board enters as a smell in the antennal lobe, turns on a
// sparse set of Kenyon cells, and drives the output neurons through 15 lobe compartments; dopamine from PAM (reward)
// or PPL1 (punishment) neurons rewrites the synapses in its own compartments.
//
// Two layouts: a wide one that reads left to right, and a tall one for phones that reads top to bottom.
import { CELLS } from "../game/board.ts";
import { MBON_COMPARTMENT, PAM, PPL1 } from "../mb/circuit.ts";
import type { ReadyInfo, StepFrame, TurboFrame } from "../mb/protocol.ts";
import { C, F, fitCanvas, tileStyle } from "./theme.ts";

/** smallest label size on screen, CSS px */
const MIN_PX = 10.5;
/** below this canvas width (CSS px) the drawing stacks vertically */
const TALL_BELOW = 640;

interface Comp {
  name: string;
  cluster: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Pt = [number, number];

interface Layout {
  vw: number;
  vh: number;
  glom: (i: number) => Pt;
  glomR: number;
  al: { title: Pt; note: Pt; caption: Pt };
  calyx: { x: number; y: number; rx: number; ry: number };
  kc: { title: Pt; note: Pt; align: CanvasTextAlign; short: boolean };
  /** the peduncle, from the calyx to the heel, if there is room for it */
  peduncle: [Pt, Pt, Pt, Pt] | null;
  lobes: { title: Pt; note: Pt };
  comps: Comp[];
  out: {
    title: Pt;
    x: number;
    approachY: number;
    avoidY: number;
    barW: number;
    val: Pt;
    valLabelY: number;
    naiveY: number;
    dan: Pt;
  };
}

/** the lobes: a vertical pair (α′, α) rising from the heel, three horizontal ones (γ, β′, β) running from it */
function compartments(heel: { x: number; y: number }, top: number, end: number, gammaH: number, betaH: number): Comp[] {
  const out: Comp[] = [];
  const seg = (heel.y - top) / 3;
  const col = (name: string, x: number, clusters: number[]) => {
    for (let i = 0; i < 3; i++) out.push({ name: `${name}${i + 1}`, cluster: clusters[i], x, y: heel.y - (i + 1) * seg + 3, w: 38, h: seg - 6 });
  };
  col("α′", heel.x, [PPL1, PPL1, PPL1]);
  col("α", heel.x + 42, [PAM, PPL1, PPL1]);
  const row = (name: string, y: number, h: number, clusters: number[]) => {
    const x0 = heel.x + 86;
    const len = (end - x0) / clusters.length;
    clusters.forEach((c, i) => out.push({ name: `${name}${i + 1}`, cluster: c, x: x0 + i * len + 2, y, w: len - 4, h }));
  };
  row("γ", heel.y + 6, gammaH, [PPL1, PPL1, PAM, PAM, PAM]);
  row("β′", heel.y + 10 + gammaH, betaH, [PAM, PAM]);
  row("β", heel.y + 14 + gammaH + betaH, betaH, [PAM, PAM]);
  return out;
}

function wideLayout(): Layout {
  const heel = { x: 468, y: 270 };
  return {
    vw: 1000,
    vh: 392,
    glom: (i) => [32 + (i % 4) * 44, 100 + Math.floor(i / 4) * 44],
    glomR: 17,
    al: { title: [12, 22], note: [12, 42], caption: [12, 300] },
    calyx: { x: 330, y: 166, rx: 92, ry: 106 },
    kc: { title: [330, 22], note: [330, 42], align: "center", short: false },
    peduncle: [
      [382, 252],
      [420, 286],
      [438, 310],
      [488, 300],
    ],
    lobes: { title: [heel.x, 22], note: [heel.x, 42] },
    comps: compartments(heel, 52, 772, 40, 28),
    out: { title: [798, 22], x: 798, approachY: 74, avoidY: 144, barW: 92, val: [798, 254], valLabelY: 216, naiveY: 274, dan: [798, 302] },
  };
}

function tallLayout(): Layout {
  const heel = { x: 12, y: 500 };
  return {
    vw: 400,
    vh: 846,
    glom: (i) => [28 + (i % 4) * 40, 86 + Math.floor(i / 4) * 40],
    glomR: 15,
    al: { title: [10, 22], note: [10, 41], caption: [10, 254] },
    calyx: { x: 294, y: 152, rx: 90, ry: 88 },
    kc: { title: [294, 22], note: [294, 41], align: "center", short: true },
    peduncle: null,
    lobes: { title: [10, 318], note: [10, 337] },
    comps: compartments(heel, 356, 392, 40, 28),
    out: { title: [10, 672], x: 10, approachY: 704, avoidY: 760, barW: 112, val: [214, 742], valLabelY: 704, naiveY: 762, dan: [214, 792] },
  };
}

function compartmentOf(mbonType: string): string {
  const c = MBON_COMPARTMENT[mbonType] ?? "";
  const m = /^(γ\d|β'\d|β\d|α'\d|α\d)/.exec(c);
  return m ? m[1].replace("'", "′") : "";
}

function hash(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class CircuitView {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly info: ReadyInfo;
  private L: Layout = wideLayout();
  private readonly mbonComp: Int16Array;
  private readonly kcX: Float32Array;
  private readonly kcY: Float32Array;
  /** sunflower rank of every Kenyon cell, so both layouts scatter them the same way */
  private readonly kcRank: Int32Array;
  private readonly layer = document.createElement("canvas");
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  private board: Uint8Array = new Uint8Array(CELLS);
  private kcs: Int32Array = new Int32Array(0);
  private kcT = 0;
  private readonly drive: Float32Array;
  private readonly shown: Float32Array;
  private readonly ref: Float32Array;
  private approach = { now: 0, naive: 0 };
  private avoid = { now: 0, naive: 0 };
  private valence = 0;
  private dopamine = 0;
  private dopT = -1e9;
  private turbo = false;
  private hasFrame = false;

  constructor(canvas: HTMLCanvasElement, info: ReadyInfo) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.info = info;
    // both layouts list the compartments in the same order
    const index = new Map(this.L.comps.map((c, i) => [c.name, i]));
    this.mbonComp = Int16Array.from(info.mbon.type, (t) => index.get(compartmentOf(t)) ?? -1);
    const nc = this.L.comps.length;
    this.drive = new Float32Array(nc);
    this.shown = new Float32Array(nc);
    this.ref = new Float32Array(nc);
    const n = info.kc.n;
    this.kcX = new Float32Array(n);
    this.kcY = new Float32Array(n);
    this.kcRank = new Int32Array(n);
    Array.from({ length: n }, (_, k) => k)
      .sort((a, b) => hash(a, 3) - hash(b, 3))
      .forEach((k, i) => (this.kcRank[k] = i));
    this.placeKcs();
  }

  /** Kenyon cells: an even sunflower disc filling the calyx */
  private placeKcs(): void {
    const { x, y, rx, ry } = this.L.calyx;
    const n = this.info.kc.n;
    for (let k = 0; k < n; k++) {
      const i = this.kcRank[k];
      const a = i * 2.39996;
      const r = Math.sqrt((i + 0.5) / n);
      // jitter breaks up the moiré of a perfect sunflower
      this.kcX[k] = x + rx * r * Math.cos(a) + (hash(k, 5) - 0.5) * 2.4;
      this.kcY[k] = y + ry * r * Math.sin(a) + (hash(k, 6) - 0.5) * 2.4;
    }
  }

  resize(): void {
    const width = this.canvas.getBoundingClientRect().width;
    const tall = width < TALL_BELOW;
    if (tall !== (this.L.vw === 400)) {
      this.L = tall ? tallLayout() : wideLayout();
      this.placeKcs();
    }
    // a phone gets a canvas as tall as the drawing needs
    this.canvas.style.height = tall ? `${Math.round((width * this.L.vh) / this.L.vw)}px` : "";
    const { w, h, dpr, ctx } = fitCanvas(this.canvas);
    this.ctx = ctx;
    this.dpr = dpr;
    this.scale = Math.min(w / this.L.vw, h / this.L.vh);
    this.ox = (w - this.L.vw * this.scale) / 2;
    this.oy = tall ? 0 : (h - this.L.vh * this.scale) / 2;
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.drawStatic();
  }

  onStep(f: StepFrame, chosenBoard: Uint8Array, now: number): void {
    this.turbo = false;
    this.hasFrame = true;
    this.board = chosenBoard;
    this.kcs = f.kcs;
    this.kcT = now;
    this.drive.fill(0);
    let ap = 0;
    let apN = 0;
    let av = 0;
    let avN = 0;
    for (let m = 0; m < f.mbon.length; m++) {
      const c = this.mbonComp[m];
      if (c >= 0) this.drive[c] += f.mbon[m];
      const cl = this.info.mbon.cluster[m];
      if (cl === PPL1) {
        ap += f.mbon[m];
        apN += f.mbonNaive[m];
      } else if (cl === PAM) {
        av += f.mbon[m];
        avN += f.mbonNaive[m];
      }
    }
    for (let c = 0; c < this.drive.length; c++) this.ref[c] = this.ref[c] === 0 ? this.drive[c] : Math.max(this.ref[c] * 0.995, this.drive[c]);
    this.approach = { now: ap, naive: apN };
    this.avoid = { now: av, naive: avN };
    this.valence = f.options[f.move].valence;
    if (f.dopamine !== 0) {
      this.dopamine = f.dopamine;
      this.dopT = now;
    }
  }

  onTurbo(f: TurboFrame, now: number): void {
    this.turbo = true;
    let m = 0;
    for (const d of f.dopamine) if (Math.abs(d) > Math.abs(m)) m = d;
    if (m !== 0 && now - this.dopT > 220) {
      this.dopamine = m;
      this.dopT = now;
    }
  }

  private v(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
  }

  /** text in virtual units, but never smaller than MIN_PX on screen */
  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left"): void {
    ctx.font = font.replace(/(\d+(?:\.\d+)?)px/, (_, n: string) => `${Math.max(Number(n), MIN_PX / this.scale).toFixed(1)}px`);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  }

  /** everything that does not change: anatomy and labels */
  private drawStatic(): void {
    const ctx = this.layer.getContext("2d")!;
    const L = this.L;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    this.v(ctx);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const head = `500 17px ${F.serif}`;
    const note = `italic 400 13px ${F.serif}`;
    const small = `400 12px ${F.sans}`;

    // antennal lobe
    this.text(ctx, "Antennal lobe", ...L.al.title, head, C.ink);
    this.text(ctx, "every board cell is a smell", ...L.al.note, note, C.ink3);
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = L.glom(i);
      ctx.strokeStyle = "rgba(28, 26, 23, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, L.glomR, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.text(ctx, "32 of 267 projection neurons", L.al.caption[0], L.al.caption[1], small, C.ink3);
    this.text(ctx, "fire for each board", L.al.caption[0], L.al.caption[1] + 16, small, C.ink3);

    // Kenyon cells
    const n = this.info.kc.n.toLocaleString("en-US");
    this.text(ctx, "Kenyon cells", ...L.kc.title, head, C.ink, L.kc.align);
    this.text(ctx, L.kc.short ? `${n} · APL keeps ~10 % on` : `${n} cells · APL keeps ~10 % on`, ...L.kc.note, note, C.ink3, L.kc.align);
    ctx.fillStyle = "#d8cfbf";
    for (let k = 0; k < this.info.kc.n; k++) ctx.fillRect(this.kcX[k] - 1, this.kcY[k] - 1, 2, 2);

    // peduncle: the Kenyon-cell axons run to the lobes
    if (L.peduncle) {
      const [a, b, c, d] = L.peduncle;
      ctx.strokeStyle = "rgba(28, 26, 23, 0.06)";
      ctx.lineWidth = 30;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.bezierCurveTo(...b, ...c, ...d);
      ctx.stroke();
    }

    // compartments, each marked with the dopamine it gets
    this.text(ctx, "Lobes", ...L.lobes.title, head, C.ink);
    this.text(ctx, "15 compartments, each with its own dopamine", ...L.lobes.note, note, C.ink3);
    for (const c of L.comps) {
      ctx.fillStyle = "#ece5d7";
      ctx.strokeStyle = "rgba(28, 26, 23, 0.26)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, c.w, c.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.cluster === PAM ? C.reward : C.punish;
      ctx.beginPath();
      ctx.arc(c.x + c.w - 7, c.y + 7, 2.6, 0, Math.PI * 2);
      ctx.fill();
      this.text(ctx, c.name, c.x + 5, c.y + 14, `500 11px ${F.sans}`, C.ink2);
    }

    // output neurons and the dopamine legend
    const o = L.out;
    this.text(ctx, "Output neurons", ...o.title, head, C.ink);
    const tag = (label: string, y: number, color: string) => {
      this.text(ctx, label, o.x, y, `500 13px ${F.sans}`, C.ink);
      const w = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(o.x + w + 9, y - 4.5, 3, 0, Math.PI * 2);
      ctx.fill();
    };
    tag("approach", o.approachY, C.punish);
    tag("avoid", o.avoidY, C.reward);
    this.text(ctx, "valence: approach − avoid", o.val[0], o.valLabelY, small, C.ink3);
    const nPam = this.info.dan.cluster.filter((c) => c === PAM).length;
    const nPpl = this.info.dan.cluster.filter((c) => c === PPL1).length;
    this.text(ctx, "Dopamine neurons", ...o.dan, `500 13px ${F.sans}`, C.ink);
    this.text(ctx, `PAM · reward · ${nPam}`, o.dan[0] + 16, o.dan[1] + 22, small, C.reward);
    this.text(ctx, `PPL1 · punishment · ${nPpl}`, o.dan[0] + 16, o.dan[1] + 42, small, C.punish);
  }

  draw(now: number): void {
    const ctx = this.ctx;
    const L = this.L;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    this.v(ctx);
    const live = this.hasFrame && !this.turbo;
    const countAt: Pt = [L.calyx.x, L.calyx.y + L.calyx.ry + 26];

    if (live) {
      // the chosen board as a smell: each glomerulus takes its cell's tile
      ctx.lineWidth = 1;
      const r = L.glomR;
      for (let i = 0; i < CELLS; i++) {
        const [x, y] = L.glom(i);
        const e = this.board[i];
        // projection-neuron axons into the calyx
        const tx = L.calyx.x - L.calyx.rx * 0.75 + 40 * hash(i, 7);
        const ty = L.calyx.y - L.calyx.ry * 0.55 + L.calyx.ry * 1.1 * hash(i, 8);
        ctx.strokeStyle = e ? "rgba(28, 26, 23, 0.2)" : "rgba(28, 26, 23, 0.07)";
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.bezierCurveTo(x + 60, y, tx - 50, ty, tx, ty);
        ctx.stroke();
        if (!e) continue;
        const st = tileStyle(e);
        ctx.fillStyle = st.fill;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 ${(e >= 10 ? 9.5 : e >= 7 ? 11 : 12.5) * (r / 17)}px ${F.sans}`;
        ctx.fillStyle = st.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(2 ** e), x, y + 0.5);
      }
      // the Kenyon cells this smell turns on
      const fade = Math.min(1, (now - this.kcT) / 180);
      ctx.fillStyle = C.ink;
      ctx.globalAlpha = 0.3 + 0.7 * fade;
      for (const k of this.kcs) ctx.fillRect(this.kcX[k] - 1.5, this.kcY[k] - 1.5, 3, 3);
      ctx.globalAlpha = 1;
      this.text(ctx, `${this.kcs.length} on · ${((100 * this.kcs.length) / this.info.kc.n).toFixed(1)} %`, ...countAt, `500 12px ${F.mono}`, C.ink2, "center");
    } else if (this.turbo) {
      this.text(ctx, "Turbo: too fast to draw every smell", ...countAt, `italic 400 13px ${F.serif}`, C.ink2, "center");
    }

    // compartments: output drive as ink, dopamine as a coloured wash
    const since = now - this.dopT;
    const wash = since < 0 ? 0 : Math.exp(-Math.max(0, since - 200) / 650) * Math.min(1, Math.abs(this.dopamine) / 3 + 0.3);
    const washCluster = this.dopamine > 0 ? PAM : PPL1;
    L.comps.forEach((c, i) => {
      if (live) {
        const target = this.ref[i] > 0 ? this.drive[i] / this.ref[i] : 0;
        this.shown[i] += (target - this.shown[i]) * 0.18;
        ctx.fillStyle = `rgba(28, 26, 23, ${0.32 * Math.min(1, this.shown[i])})`;
        ctx.beginPath();
        ctx.roundRect(c.x, c.y, c.w, c.h, 5);
        ctx.fill();
      }
      if (wash > 0.01 && c.cluster === washCluster) {
        ctx.fillStyle = washCluster === PAM ? `rgba(31, 122, 77, ${0.5 * wash})` : `rgba(196, 61, 43, ${0.5 * wash})`;
        ctx.beginPath();
        ctx.roundRect(c.x, c.y, c.w, c.h, 5);
        ctx.fill();
      }
    });
    // the dopamine legend lights up with its neurons
    const o = L.out;
    for (const [cl, dy, color] of [
      [PAM, 18, C.reward],
      [PPL1, 38, C.punish],
    ] as const) {
      const on = wash > 0.01 && washCluster === cl ? wash : 0;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35 + 0.65 * on;
      ctx.beginPath();
      ctx.arc(o.dan[0] + 5, o.dan[1] + dy, 4 + 3 * on, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // output neurons: drive now, and where a naive fly would be (gold tick)
    if (live) {
      const max = Math.max(1, this.approach.naive, this.avoid.naive, this.approach.now, this.avoid.now) * 1.08;
      const bar = (y: number, v: { now: number; naive: number }) => {
        const bw = o.barW;
        ctx.fillStyle = C.faint;
        ctx.fillRect(o.x, y, bw, 6);
        ctx.fillStyle = C.ink;
        ctx.fillRect(o.x, y, bw * (v.now / max), 6);
        ctx.fillStyle = C.accent;
        ctx.fillRect(o.x + bw * (v.naive / max) - 1, y - 4, 2, 14);
        const pct = v.naive > 0 ? Math.round((100 * v.now) / v.naive) : 100;
        this.text(ctx, `${pct}%`, o.x + bw + 8, y + 7, `500 12px ${F.mono}`, C.ink2);
      };
      bar(o.approachY + 12, this.approach);
      bar(o.avoidY + 12, this.avoid);
      this.text(ctx, `${this.valence >= 0 ? "+" : "−"}${Math.abs(this.valence).toFixed(2)}`, ...o.val, `500 28px ${F.serif}`, C.ink);
      this.text(ctx, "▮ = a naive fly", o.val[0], o.naiveY, `400 11px ${F.sans}`, C.accent);
    }
  }
}
