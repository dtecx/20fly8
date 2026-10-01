// Panel c: the mushroom body as a live drawing. The chosen board enters as a smell in the antennal lobe, turns on a
// sparse set of Kenyon cells, and drives the output neurons through 15 lobe compartments; dopamine from PAM (reward)
// or PPL1 (punishment) neurons rewrites the synapses in its own compartments.
import { CELLS } from "../game/board.ts";
import { MBON_COMPARTMENT, PAM, PPL1 } from "../mb/circuit.ts";
import type { ReadyInfo, StepFrame, TurboFrame } from "../mb/protocol.ts";
import { C, F, fitCanvas, tileStyle } from "./theme.ts";

const VW = 1000;
const VH = 392;
/** smallest label size on screen, CSS px */
const MIN_PX = 10.5;

interface Comp {
  name: string;
  cluster: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** where dopamine axons enter */
  ax: number;
  ay: number;
}

// the lobes: a vertical pair (α′, α) rising from the heel, three horizontal ones (γ, β′, β) running from it
const HEEL = { x: 468, y: 270 };
const LOBE_END = 772;
const OUT_X = 798;

function compartments(): Comp[] {
  const out: Comp[] = [];
  const top = 52;
  const seg = (HEEL.y - top) / 3;
  const col = (name: string, x: number, clusters: number[]) => {
    for (let i = 0; i < 3; i++) {
      const y = HEEL.y - (i + 1) * seg + 3;
      out.push({ name: `${name}${i + 1}`, cluster: clusters[i], x, y, w: 38, h: seg - 6, ax: x, ay: y + seg / 2 });
    }
  };
  col("α′", HEEL.x, [PPL1, PPL1, PPL1]);
  col("α", HEEL.x + 42, [PAM, PPL1, PPL1]);
  const row = (name: string, y: number, h: number, clusters: number[]) => {
    const x0 = HEEL.x + 86;
    const len = (LOBE_END - x0) / clusters.length;
    clusters.forEach((c, i) => out.push({ name: `${name}${i + 1}`, cluster: c, x: x0 + i * len + 2, y, w: len - 4, h, ax: x0 + i * len + len / 2, ay: y + h }));
  };
  row("γ", HEEL.y + 6, 40, [PPL1, PPL1, PAM, PAM, PAM]);
  row("β′", HEEL.y + 50, 28, [PAM, PAM]);
  row("β", HEEL.y + 82, 28, [PAM, PAM]);
  return out;
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

/** glomerulus of board cell i */
const glom = (i: number): [number, number] => [32 + (i % 4) * 44, 100 + Math.floor(i / 4) * 44];
const CALYX = { x: 330, y: 166, rx: 92, ry: 106 };

export class CircuitView {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly info: ReadyInfo;
  private readonly comps = compartments();
  private readonly mbonComp: Int16Array;
  private readonly kcX: Float32Array;
  private readonly kcY: Float32Array;
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
    const index = new Map(this.comps.map((c, i) => [c.name, i]));
    this.mbonComp = Int16Array.from(info.mbon.type, (t) => index.get(compartmentOf(t)) ?? -1);
    this.drive = new Float32Array(this.comps.length);
    this.shown = new Float32Array(this.comps.length);
    this.ref = new Float32Array(this.comps.length);

    // Kenyon cells: an even sunflower disc, the calyx
    const n = info.kc.n;
    this.kcX = new Float32Array(n);
    this.kcY = new Float32Array(n);
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => hash(a, 3) - hash(b, 3));
    order.forEach((k, i) => {
      const a = i * 2.39996;
      const r = Math.sqrt((i + 0.5) / n);
      // jitter breaks up the moiré of a perfect sunflower
      this.kcX[k] = CALYX.x + CALYX.rx * r * Math.cos(a) + (hash(k, 5) - 0.5) * 2.4;
      this.kcY[k] = CALYX.y + CALYX.ry * r * Math.sin(a) + (hash(k, 6) - 0.5) * 2.4;
    });
  }

  resize(): void {
    const { w, h, dpr, ctx } = fitCanvas(this.canvas);
    this.ctx = ctx;
    this.dpr = dpr;
    this.scale = Math.min(w / VW, h / VH);
    this.ox = (w - VW * this.scale) / 2;
    this.oy = (h - VH * this.scale) / 2;
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
    for (let c = 0; c < this.comps.length; c++) this.ref[c] = this.ref[c] === 0 ? this.drive[c] : Math.max(this.ref[c] * 0.995, this.drive[c]);
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    this.v(ctx);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const head = `500 17px ${F.serif}`;
    const note = `italic 400 13px ${F.serif}`;
    const small = `400 12px ${F.sans}`;

    // antennal lobe
    this.text(ctx, "Antennal lobe", 12, 22, head, C.ink);
    this.text(ctx, "every board cell is a smell", 12, 42, note, C.ink3);
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = glom(i);
      ctx.strokeStyle = "rgba(28, 26, 23, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.text(ctx, "32 of 267 projection neurons", 12, 300, small, C.ink3);
    this.text(ctx, "fire for each board", 12, 316, small, C.ink3);

    // Kenyon cells
    this.text(ctx, "Kenyon cells", CALYX.x, 22, head, C.ink, "center");
    this.text(ctx, `${this.info.kc.n.toLocaleString("en-US")} cells · APL keeps ~10 % on`, CALYX.x, 42, note, C.ink3, "center");
    ctx.fillStyle = "#d8cfbf";
    for (let k = 0; k < this.info.kc.n; k++) ctx.fillRect(this.kcX[k] - 1, this.kcY[k] - 1, 2, 2);

    // peduncle: the Kenyon-cell axons run to the lobes
    ctx.strokeStyle = "rgba(28, 26, 23, 0.06)";
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(CALYX.x + 52, CALYX.y + 86);
    ctx.bezierCurveTo(CALYX.x + 90, CALYX.y + 120, HEEL.x - 30, HEEL.y + 40, HEEL.x + 20, HEEL.y + 30);
    ctx.stroke();

    // compartments, each marked with the dopamine it gets
    this.text(ctx, "Lobes", HEEL.x, 22, head, C.ink);
    this.text(ctx, "15 compartments, each with its own dopamine", HEEL.x, 42, note, C.ink3);
    for (const c of this.comps) {
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
    this.text(ctx, "Output neurons", OUT_X, 22, head, C.ink);
    const tag = (label: string, y: number, color: string) => {
      this.text(ctx, label, OUT_X, y, `500 13px ${F.sans}`, C.ink);
      const w = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(OUT_X + w + 9, y - 4.5, 3, 0, Math.PI * 2);
      ctx.fill();
    };
    tag("approach", 74, C.punish);
    tag("avoid", 144, C.reward);
    this.text(ctx, "valence: approach − avoid", OUT_X, 216, small, C.ink3);
    const nPam = this.info.dan.cluster.filter((c) => c === PAM).length;
    const nPpl = this.info.dan.cluster.filter((c) => c === PPL1).length;
    this.text(ctx, "Dopamine neurons", OUT_X, 302, `500 13px ${F.sans}`, C.ink);
    this.text(ctx, `PAM · reward · ${nPam}`, OUT_X + 16, 324, small, C.reward);
    this.text(ctx, `PPL1 · punishment · ${nPpl}`, OUT_X + 16, 344, small, C.punish);
  }

  draw(now: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    this.v(ctx);
    const live = this.hasFrame && !this.turbo;

    if (live) {
      // the chosen board as a smell: each glomerulus takes its cell's tile
      ctx.lineWidth = 1;
      for (let i = 0; i < CELLS; i++) {
        const [x, y] = glom(i);
        const e = this.board[i];
        // projection-neuron axons into the calyx
        const tx = CALYX.x - 70 + 40 * hash(i, 7);
        const ty = CALYX.y - 60 + 120 * hash(i, 8);
        ctx.strokeStyle = e ? "rgba(28, 26, 23, 0.2)" : "rgba(28, 26, 23, 0.07)";
        ctx.beginPath();
        ctx.moveTo(x + 17, y);
        ctx.bezierCurveTo(x + 70, y, tx - 60, ty, tx, ty);
        ctx.stroke();
        if (!e) continue;
        const st = tileStyle(e);
        ctx.fillStyle = st.fill;
        ctx.beginPath();
        ctx.arc(x, y, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 ${e >= 10 ? 9.5 : e >= 7 ? 11 : 12.5}px ${F.sans}`;
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
      this.text(ctx, `${this.kcs.length} on · ${((100 * this.kcs.length) / this.info.kc.n).toFixed(1)} %`, CALYX.x, CALYX.y + CALYX.ry + 26, `500 12px ${F.mono}`, C.ink2, "center");
    } else if (this.turbo) {
      this.text(ctx, "Turbo: too fast to draw every smell", CALYX.x, CALYX.y + CALYX.ry + 26, `italic 400 13px ${F.serif}`, C.ink2, "center");
    }

    // compartments: output drive as ink, dopamine as a coloured wash
    const since = now - this.dopT;
    const wash = since < 0 ? 0 : Math.exp(-Math.max(0, since - 200) / 650) * Math.min(1, Math.abs(this.dopamine) / 3 + 0.3);
    const washCluster = this.dopamine > 0 ? PAM : PPL1;
    for (let i = 0; i < this.comps.length; i++) {
      const c = this.comps[i];
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
    }
    // the dopamine legend lights up with its neurons
    for (const [cl, y, color] of [
      [PAM, 320, C.reward],
      [PPL1, 340, C.punish],
    ] as const) {
      const on = wash > 0.01 && washCluster === cl ? wash : 0;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35 + 0.65 * on;
      ctx.beginPath();
      ctx.arc(OUT_X + 5, y, 4 + 3 * on, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // output neurons: drive now, and where a naive fly would be (gold tick)
    if (live) {
      const max = Math.max(1, this.approach.naive, this.avoid.naive, this.approach.now, this.avoid.now) * 1.08;
      const bar = (y: number, v: { now: number; naive: number }) => {
        const bw = 92;
        ctx.fillStyle = C.faint;
        ctx.fillRect(OUT_X, y, bw, 6);
        ctx.fillStyle = C.ink;
        ctx.fillRect(OUT_X, y, bw * (v.now / max), 6);
        ctx.fillStyle = C.accent;
        ctx.fillRect(OUT_X + bw * (v.naive / max) - 1, y - 4, 2, 14);
        const pct = v.naive > 0 ? Math.round((100 * v.now) / v.naive) : 100;
        this.text(ctx, `${pct}%`, OUT_X + bw + 8, y + 7, `500 12px ${F.mono}`, C.ink2);
      };
      bar(86, this.approach);
      bar(156, this.avoid);
      this.text(ctx, `${this.valence >= 0 ? "+" : "−"}${Math.abs(this.valence).toFixed(2)}`, OUT_X, 254, `500 28px ${F.serif}`, C.ink);
      this.text(ctx, "▮ = a naive fly", OUT_X, 274, `400 11px ${F.sans}`, C.accent);
    }
  }
}
