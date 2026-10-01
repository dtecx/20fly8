// The 2048 board: slides, merges and new tiles, drawn to the figure's palette.
import { CELLS, traceSlide, type Move, type TileMove } from "./board.ts";
import { C, F, drawTile, fitCanvas } from "../ui/theme.ts";

export interface Timing {
  /** the fly smells the four options before it moves */
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

const ease = (k: number) => 1 - (1 - k) ** 3;

export class BoardView {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private bx = 0;
  private by = 0;
  private bs = 1;
  private cell = 1;
  private gap = 1;
  private board: Uint8Array = new Uint8Array(CELLS);
  private anim: Anim | null = null;
  /** dim the board and say why (paused, game over, turbo) */
  private veil: { title: string; line: string; tone: string } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const { w, h, ctx } = fitCanvas(this.canvas);
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.bs = Math.max(120, Math.min(w, h) - 4);
    this.bx = (w - this.bs) / 2;
    this.by = 2;
    this.gap = this.bs * 0.026;
    this.cell = (this.bs - 5 * this.gap) / 4;
  }

  setBoard(board: Uint8Array): void {
    this.board = board.slice();
    this.anim = null;
  }

  setVeil(veil: { title: string; line: string; tone: string } | null): void {
    this.veil = veil;
  }

  playMove(before: Uint8Array, move: Move, after: Uint8Array, spawn: number, timing: Timing, now: number): void {
    const trace = traceSlide(before, move);
    const merged = new Set<number>();
    for (const t of trace) if (t.merged) merged.add(t.to);
    this.board = before.slice();
    this.anim = { t0: now, timing, trace, after: after.slice(), spawn, merged, move };
  }

  /** ms until the current move has finished animating */
  busyFor(now: number): number {
    if (!this.anim) return 0;
    const { sniff, slide, pop } = this.anim.timing;
    return Math.max(0, this.anim.t0 + sniff + slide + pop - now);
  }

  private xy(i: number): [number, number] {
    return [this.bx + this.gap + (i % 4) * (this.cell + this.gap), this.by + this.gap + Math.floor(i / 4) * (this.cell + this.gap)];
  }

  draw(now: number): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const r = this.bs * 0.028;
    ctx.fillStyle = C.paper2;
    ctx.beginPath();
    ctx.roundRect(this.bx, this.by, this.bs, this.bs, r);
    ctx.fill();
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = this.xy(i);
      ctx.fillStyle = "#ded6c6";
      ctx.beginPath();
      ctx.roundRect(x, y, this.cell, this.cell, this.cell * 0.075);
      ctx.fill();
    }

    const a = this.anim;
    if (!a) this.drawStill(this.board);
    else {
      const t = now - a.t0;
      const { sniff, slide, pop } = a.timing;
      if (t < sniff) this.drawStill(this.board);
      else if (t < sniff + slide) {
        const e = ease((t - sniff) / slide);
        for (const m of a.trace) {
          const [x0, y0] = this.xy(m.from);
          const [x1, y1] = this.xy(m.to);
          drawTile(ctx, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, this.cell, m.value);
        }
      } else {
        const k = Math.min(1, (t - sniff - slide) / Math.max(1, pop));
        for (let i = 0; i < CELLS; i++) {
          const v = a.after[i];
          if (!v) continue;
          let scale = 1;
          if (i === a.spawn) scale = 0.3 + 0.7 * ease(k);
          else if (a.merged.has(i)) scale = 1 + 0.09 * Math.sin(Math.PI * k);
          const [x, y] = this.xy(i);
          ctx.globalAlpha = i === a.spawn ? Math.min(1, 0.2 + k * 1.6) : 1;
          drawTile(ctx, x, y, this.cell, v, scale);
          ctx.globalAlpha = 1;
        }
        if (k >= 1) {
          this.board = a.after;
          this.anim = null;
        }
      }
    }

    if (this.veil) {
      ctx.fillStyle = "rgba(243, 238, 228, 0.78)";
      ctx.beginPath();
      ctx.roundRect(this.bx, this.by, this.bs, this.bs, r);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = this.veil.tone;
      ctx.font = `italic 500 ${Math.round(this.bs * 0.085)}px ${F.serif}`;
      ctx.fillText(this.veil.title, this.bx + this.bs / 2, this.by + this.bs * 0.46);
      ctx.fillStyle = C.ink2;
      ctx.font = `400 ${Math.round(Math.max(13, this.bs * 0.034))}px ${F.serif}`;
      ctx.fillText(this.veil.line, this.bx + this.bs / 2, this.by + this.bs * 0.56);
    }
  }

  private drawStill(b: Uint8Array): void {
    for (let i = 0; i < CELLS; i++) if (b[i]) drawTile(this.ctx, ...this.xy(i), this.cell, b[i]);
  }
}
