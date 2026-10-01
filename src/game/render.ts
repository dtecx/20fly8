// Notebook-paper rendering: the 2048 board, what the fly thinks of each move, the fly itself and its learning curve.
import { CELLS, MOVE_ARROWS, traceSlide, type Move, type TileMove } from "./board.ts";
import { drawFly, type FlyPose } from "./fly2d.ts";
import type { GameRecord } from "../mb/agent.ts";
import type { OptionView } from "../mb/protocol.ts";

const PAPER = "#fbf6e8";
const GRID = "#e6dcc1";
const INK = "#2a1c0f";
const RED_INK = "#c2410c";
const HUD_H = 54;
const HAND = `Pangolin, "Comic Sans MS", cursive`;
/** mean score of uniformly random play (2,000 games, scripts/eval.ts) */
export const RANDOM_MEAN = 1067;

/** tile colours by exponent: crayon versions of the classic palette */
const TILE: { fill: string; ink: string }[] = [
  { fill: "#efe6cf", ink: INK },
  { fill: "#fbf3df", ink: "#5c4a33" }, // 2
  { fill: "#f6e3bd", ink: "#5c4a33" }, // 4
  { fill: "#f8b779", ink: "#fffaf0" }, // 8
  { fill: "#f59a5f", ink: "#fffaf0" }, // 16
  { fill: "#f37d5c", ink: "#fffaf0" }, // 32
  { fill: "#ec5c3b", ink: "#fffaf0" }, // 64
  { fill: "#eed27a", ink: "#fffaf0" }, // 128
  { fill: "#edcd65", ink: "#fffaf0" }, // 256
  { fill: "#ecc850", ink: "#fffaf0" }, // 512
  { fill: "#ebc33e", ink: "#fffaf0" }, // 1024
  { fill: "#eabe2b", ink: "#fffaf0" }, // 2048
  { fill: "#7a5cd6", ink: "#fffaf0" }, // 4096
  { fill: "#5b3fb8", ink: "#fffaf0" },
  { fill: "#3b2a7a", ink: "#fffaf0" },
  { fill: "#24194a", ink: "#fffaf0" },
];
/** learning-curve dot colour by the game's largest tile */
const DOT: Record<number, string> = { 7: "#b8ab90", 8: "#e0a458", 9: "#e8743b", 10: "#d9342b", 11: "#e2b100", 12: "#7a5cd6" };

export interface Timing {
  sniff: number;
  slide: number;
  pop: number;
}

interface Anim {
  t0: number;
  timing: Timing;
  trace: TileMove[];
  after: Uint8Array;
  spawn: number;
  merged: Set<number>;
  move: Move;
}

export interface PaperState {
  score: number;
  best: number;
  game: number;
  turbo: boolean;
  paused: boolean;
  learning: boolean;
  /** 0..1: sugar just tasted (proboscis), game over (startle) */
  proboscis: number;
  startle: number;
  gameOver: boolean;
}

function rand(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class PaperRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  // layout
  private bx = 0;
  private by = 0;
  private bs = 1;
  private cell = 1;
  private gap = 1;
  private curve = { x: 0, y: 0, w: 1, h: 1 };

  private board: Uint8Array = new Uint8Array(CELLS);
  private anim: Anim | null = null;
  private options: OptionView[] | null = null;
  private chosen: Move | -1 = -1;
  private optionsT0 = 0;
  private history: GameRecord[] = [];
  private wingPhase = 0;
  private lookTarget = 0;
  private look = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    const W = this.cssW;
    const H = this.cssH;
    const curveH = Math.max(130, Math.min(250, H * 0.25));
    const arrowZone = 58;
    const top = HUD_H + 70; // room for the fly and the "up" arrow
    const avail = H - top - arrowZone - curveH - 34;
    this.bs = Math.max(160, Math.min(W - 2 * 96, avail, 560));
    this.bx = (W - this.bs) / 2;
    this.by = top + Math.max(0, (avail - this.bs) / 2);
    this.gap = this.bs * 0.028;
    this.cell = (this.bs - 5 * this.gap) / 4;
    const cy = this.by + this.bs + arrowZone + 6;
    this.curve = { x: 54, y: cy, w: W - 54 - 24, h: H - cy - 22 };
  }

  setHistory(h: GameRecord[]): void {
    this.history = h;
  }

  /** show a board as is (turbo, a new game) */
  setBoard(board: Uint8Array): void {
    this.board = board.slice();
    this.anim = null;
  }

  setOptions(options: OptionView[] | null, chosen: Move | -1, now: number): void {
    this.options = options;
    this.chosen = chosen;
    this.optionsT0 = now;
    if (chosen >= 0) this.lookTarget = chosen === 1 ? 1 : chosen === 3 ? -1 : 0;
  }

  /** animate one move: sniff the options, slide, pop the merges and the new tile */
  playMove(before: Uint8Array, move: Move, after: Uint8Array, spawn: number, timing: Timing, now: number): void {
    const trace = traceSlide(before, move);
    const merged = new Set<number>();
    for (const t of trace) if (t.merged) merged.add(t.to);
    this.board = before.slice();
    this.anim = { t0: now, timing, trace, after: after.slice(), spawn, merged, move };
  }

  /** ms until the current move animation is done */
  busyFor(now: number): number {
    if (!this.anim) return 0;
    const { sniff, slide, pop } = this.anim.timing;
    return Math.max(0, this.anim.t0 + sniff + slide + pop - now);
  }

  private cellXY(i: number): [number, number] {
    const r = Math.floor(i / 4);
    const c = i % 4;
    return [this.bx + this.gap + c * (this.cell + this.gap), this.by + this.gap + r * (this.cell + this.gap)];
  }

  draw(now: number, dt: number, s: PaperState): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0.5; y < this.cssH; y += 20) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.cssW, y);
    }
    for (let x = 0.5; x < this.cssW; x += 20) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.cssH);
    }
    ctx.stroke();

    this.drawBoard(now);
    this.drawOptions(now, s);
    this.drawFly(dt, s);
    this.drawCurve(s);
    this.drawHud(s);
  }

  private drawBoard(now: number): void {
    const { ctx } = this;
    // cardboard tray
    ctx.save();
    ctx.fillStyle = "rgba(42, 28, 15, 0.85)";
    ctx.beginPath();
    ctx.roundRect(this.bx + 4, this.by + 4, this.bs, this.bs, 16);
    ctx.fill();
    ctx.fillStyle = "#d9c9a6";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(this.bx, this.by, this.bs, this.bs, 16);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = this.cellXY(i);
      ctx.fillStyle = "#cdbb95";
      ctx.beginPath();
      ctx.roundRect(x, y, this.cell, this.cell, this.cell * 0.12);
      ctx.fill();
    }
    ctx.restore();

    const a = this.anim;
    if (!a) {
      for (let i = 0; i < CELLS; i++) if (this.board[i]) this.tile(...this.cellXY(i), this.board[i], 1, i * 7 + this.board[i]);
      return;
    }
    const t = now - a.t0;
    const { sniff, slide, pop } = a.timing;
    if (t < sniff) {
      for (let i = 0; i < CELLS; i++) if (this.board[i]) this.tile(...this.cellXY(i), this.board[i], 1, i * 7 + this.board[i]);
      return;
    }
    if (t < sniff + slide) {
      const k = (t - sniff) / slide;
      const e = 1 - (1 - k) * (1 - k);
      for (const m of a.trace) {
        const [x0, y0] = this.cellXY(m.from);
        const [x1, y1] = this.cellXY(m.to);
        this.tile(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, m.value, 1, m.from * 7 + m.value);
      }
      return;
    }
    const k = Math.min(1, (t - sniff - slide) / Math.max(1, pop));
    for (let i = 0; i < CELLS; i++) {
      const v = a.after[i];
      if (!v) continue;
      let scale = 1;
      if (i === a.spawn) scale = 0.2 + 0.8 * (1 - (1 - k) ** 3);
      else if (a.merged.has(i)) scale = 1 + 0.16 * Math.sin(Math.PI * k);
      this.tile(...this.cellXY(i), v, scale, i * 7 + v);
    }
    if (k >= 1) {
      this.board = a.after;
      this.anim = null;
    }
  }

  private tile(x: number, y: number, v: number, scale: number, seed: number): void {
    const { ctx } = this;
    const c = this.cell;
    const pal = TILE[Math.min(v, TILE.length - 1)];
    ctx.save();
    ctx.translate(x + c / 2, y + c / 2);
    ctx.scale(scale, scale);
    ctx.rotate((rand(seed, 1) - 0.5) * 0.025);
    const r = c * 0.12;
    ctx.fillStyle = "rgba(42, 28, 15, 0.8)";
    ctx.beginPath();
    ctx.roundRect(-c / 2 + 3, -c / 2 + 3, c, c, r);
    ctx.fill();
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(-c / 2, -c / 2, c, c, r);
    ctx.fill();
    ctx.stroke();
    // a crayon highlight
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = Math.max(2, c * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-c / 2 + r * 1.2, -c / 2 + c * 0.13);
    ctx.lineTo(c * 0.1, -c / 2 + c * 0.13);
    ctx.stroke();
    if (v >= 11) {
      ctx.shadowColor = "rgba(255, 210, 60, 0.9)";
      ctx.shadowBlur = 18;
    }
    const text = String(2 ** v);
    const size = c * (text.length <= 2 ? 0.5 : text.length === 3 ? 0.4 : text.length === 4 ? 0.32 : 0.26);
    ctx.font = `${Math.round(size)}px ${HAND}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = pal.ink;
    if (pal.ink !== INK && pal.ink !== "#5c4a33") {
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.strokeStyle = "rgba(42, 28, 15, 0.55)";
      ctx.strokeText(text, 0, c * 0.03);
    }
    ctx.fillText(text, 0, c * 0.03);
    ctx.restore();
  }

  /** an arrow on each side of the board with what the fly thinks of that move */
  private drawOptions(now: number, s: PaperState): void {
    const opts = this.options;
    if (!opts || s.turbo) return;
    const { ctx } = this;
    const grow = Math.min(1, (now - this.optionsT0) / 260);
    const legal = opts.filter((o) => o.legal);
    const lo = Math.min(...legal.map((o) => o.worth));
    const hi = Math.max(...legal.map((o) => o.worth));
    const span = Math.max(1e-6, hi - lo);
    const cx = this.bx + this.bs / 2;
    const cy = this.by + this.bs / 2;
    const off = this.bs / 2 + 30;
    const place: [number, number][] = [
      [cx, cy - off],
      [cx + off + 8, cy],
      [cx, cy + off],
      [cx - off - 8, cy],
    ];
    for (let m = 0; m < 4; m++) {
      const o = opts[m];
      const [x, y] = place[m];
      const chosen = m === this.chosen;
      ctx.save();
      ctx.translate(x, y);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (!o.legal) {
        ctx.globalAlpha = 0.35;
        ctx.font = `22px ${HAND}`;
        ctx.fillStyle = INK;
        ctx.fillText(MOVE_ARROWS[m], 0, -8);
        ctx.font = `13px ${HAND}`;
        ctx.fillText("blocked", 0, 13);
        ctx.restore();
        continue;
      }
      const rel = ((o.worth - lo) / span) * grow;
      ctx.font = `${chosen ? 26 : 22}px ${HAND}`;
      ctx.fillStyle = chosen ? RED_INK : INK;
      ctx.fillText(MOVE_ARROWS[m], 0, -9);
      // liking bar
      const bw = 58;
      ctx.fillStyle = "rgba(42, 28, 15, 0.12)";
      ctx.fillRect(-bw / 2, 6, bw, 6);
      ctx.fillStyle = chosen ? RED_INK : "#8a6a3c";
      ctx.fillRect(-bw / 2, 6, bw * (0.08 + 0.92 * rel), 6);
      ctx.font = `13px ${HAND}`;
      ctx.fillStyle = INK;
      const sugar = o.sugar ? ` +${o.sugar}🍬` : "";
      ctx.fillText(`${o.valence >= 0 ? "+" : ""}${o.valence.toFixed(1)}${sugar}`, 0, 24);
      if (chosen) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "rgba(194, 65, 12, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 6, 44, 28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawFly(dt: number, s: PaperState): void {
    const { ctx } = this;
    this.wingPhase += dt * (s.turbo ? 60 : 12);
    this.look += (this.lookTarget - this.look) * Math.min(1, dt * 6);
    const pose: FlyPose = {
      facing: -1,
      legs: 1,
      wingPhase: this.wingPhase,
      wingAmp: s.turbo ? 0.9 : 0.1 + 0.6 * s.startle,
      squash: 0,
      proboscis: s.proboscis,
      look: -this.look,
      startle: s.startle,
      dead: false,
    };
    ctx.save();
    // perched on the top-right corner of the board, facing it
    ctx.translate(this.bx + this.bs - 34, this.by - 3);
    ctx.scale(1.25, -1.25);
    drawFly(ctx, pose);
    ctx.restore();
  }

  private drawCurve(s: PaperState): void {
    const { ctx } = this;
    const { x, y, w, h } = this.curve;
    if (h < 60) return;
    const hist = this.history;
    ctx.save();
    ctx.font = `17px ${HAND}`;
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("how the fly is doing — score of every game", x - 30, y + 2);
    const px = x;
    const py = y + 14;
    const pw = w;
    const ph = h - 30;
    // axes
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + ph);
    ctx.lineTo(px + pw, py + ph);
    ctx.stroke();
    const lo = Math.log10(200);
    const hi = Math.log10(80000);
    const yOf = (score: number) => py + ph - ((Math.log10(Math.max(200, score)) - lo) / (hi - lo)) * ph;
    ctx.font = `12px ${HAND}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of [500, 1000, 2000, 5000, 10000, 20000, 50000]) {
      const ty = yOf(t);
      ctx.fillStyle = "rgba(42, 28, 15, 0.7)";
      ctx.fillText(t >= 1000 ? `${t / 1000}k` : String(t), px - 6, ty);
      ctx.strokeStyle = "rgba(42, 28, 15, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 1, ty);
      ctx.lineTo(px + pw, ty);
      ctx.stroke();
    }
    // random play
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(42, 28, 15, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, yOf(RANDOM_MEAN));
    ctx.lineTo(px + pw, yOf(RANDOM_MEAN));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(42, 28, 15, 0.6)";
    ctx.fillText("random button-mashing", px + pw - 4, yOf(RANDOM_MEAN) - 2);

    const n = hist.length;
    if (n === 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `15px ${HAND}`;
      ctx.fillStyle = "rgba(42, 28, 15, 0.6)";
      ctx.fillText("the first game is still running…", px + pw / 2, py + ph * 0.35);
      ctx.restore();
      return;
    }
    const xOf = (i: number) => px + 4 + ((pw - 8) * (i + 0.5)) / Math.max(n, 30);
    // games without dopamine: shaded
    ctx.fillStyle = "rgba(255, 107, 129, 0.12)";
    for (let i = 0; i < n; i++) {
      if (hist[i].learning) continue;
      let j = i;
      while (j + 1 < n && !hist[j + 1].learning) j++;
      ctx.fillRect(xOf(i) - 2, py, xOf(j) - xOf(i) + 4, ph);
      i = j;
    }
    const stride = Math.max(1, Math.floor(n / 1500));
    const r = n > 600 ? 1.6 : n > 150 ? 2.4 : 3.2;
    for (let i = 0; i < n; i++) {
      const g = hist[i];
      if (i % stride && g.maxTile < 11) continue;
      ctx.fillStyle = DOT[Math.min(12, g.maxTile)] ?? "#cfc5ae";
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(g.score), g.maxTile >= 11 ? r + 1.5 : r, 0, Math.PI * 2);
      ctx.fill();
    }
    // running mean of the last 50 games
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let sum = 0;
    const win = 50;
    const step = Math.max(1, Math.floor(n / 600));
    for (let i = 0; i < n; i++) {
      sum += hist[i].score;
      if (i >= win) sum -= hist[i - win].score;
      if (i % step && i !== n - 1) continue;
      const m = sum / Math.min(i + 1, win);
      if (i === 0) ctx.moveTo(xOf(i), yOf(m));
      else ctx.lineTo(xOf(i), yOf(m));
    }
    ctx.stroke();
    // legend + x labels
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = `12px ${HAND}`;
    ctx.fillStyle = "rgba(42, 28, 15, 0.7)";
    ctx.fillText("game 1", px, py + ph + 4);
    ctx.textAlign = "right";
    ctx.fillText(`game ${n}`, px + pw, py + ph + 4);
    let lx = px + pw * 0.22;
    ctx.textAlign = "left";
    for (const [e, label] of [
      [8, "256"],
      [9, "512"],
      [10, "1024"],
      [11, "2048"],
    ] as const) {
      ctx.fillStyle = DOT[e];
      ctx.beginPath();
      ctx.arc(lx, py + ph + 11, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(42, 28, 15, 0.75)";
      ctx.fillText(label, lx + 7, py + ph + 4);
      lx += 52;
    }
    ctx.fillText("— mean of the last 50", lx + 6, py + ph + 4);
    if (!s.learning) {
      ctx.fillStyle = "#c2253d";
      ctx.textAlign = "right";
      ctx.fillText("shaded: dopamine blocked", px + pw, py - 14);
    }
    ctx.restore();
  }

  private drawHud(s: PaperState): void {
    const { ctx } = this;
    const w = this.cssW;
    ctx.fillStyle = "rgba(242, 232, 206, 0.93)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, HUD_H);
    for (let x = w; x >= 0; x -= 14) ctx.lineTo(x, HUD_H + (Math.floor(x / 14) % 2 ? 5 : -2));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(90, 70, 40, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `34px ${HAND}`;
    ctx.fillText(String(s.score), 18, HUD_H / 2 + 2);
    ctx.textAlign = "right";
    ctx.font = `17px ${HAND}`;
    ctx.fillText(`best ${s.best}   ·   game #${s.game}`, w - 64, HUD_H / 2 + 1);

    const cx = w / 2;
    const midY = this.by + this.bs / 2;
    if (s.paused) {
      ctx.fillStyle = "rgba(251, 246, 232, 0.6)";
      ctx.fillRect(0, HUD_H + 4, w, this.cssH - HUD_H - 4);
      ctx.textAlign = "center";
      ctx.fillStyle = INK;
      ctx.font = `44px ${HAND}`;
      ctx.fillText("paused", cx, midY);
      ctx.font = `19px ${HAND}`;
      ctx.fillText("press space to let the fly play", cx, midY + 40);
    } else if (s.turbo) {
      ctx.textAlign = "center";
      ctx.font = `20px ${HAND}`;
      ctx.fillStyle = RED_INK;
      ctx.fillText("turbo: thousands of moves a second, learning as it goes", cx, this.by - 40);
    } else if (s.gameOver) {
      ctx.fillStyle = "rgba(251, 246, 232, 0.55)";
      ctx.beginPath();
      ctx.roundRect(this.bx, this.by, this.bs, this.bs, 16);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.font = `46px ${HAND}`;
      ctx.fillStyle = "#b91c1c";
      ctx.fillText("stuck!", cx, midY - 10);
      ctx.font = `20px ${HAND}`;
      ctx.fillStyle = INK;
      ctx.fillText("dopamine: worse than expected", cx, midY + 30);
    }
  }
}
