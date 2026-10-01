// Panel b: the four boards the fly could make, what its mushroom body thinks of each, and which one it picks.
import { CELLS } from "../game/board.ts";
import type { OptionView } from "../mb/protocol.ts";
import { C, F, drawTile, fitCanvas } from "./theme.ts";

const ARROWS = ["↑", "→", "↓", "←"];
const NAMES = ["Up", "Right", "Down", "Left"];

export class FuturesView {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private cols = 4;
  private options: OptionView[] | null = null;
  private before: Uint8Array = new Uint8Array(CELLS);
  private chosen = -1;
  private t0 = 0;
  private shown = [0, 0, 0, 0];
  private turboRate = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const parentW = this.canvas.getBoundingClientRect().width || this.canvas.parentElement!.clientWidth;
    this.cols = parentW >= 760 ? 4 : 2;
    // four in a row: the stylesheet sets the height; two by two: as tall as two rows of boards
    const s = Math.min((parentW / 2) * 0.42, 150);
    this.canvas.style.height = this.cols === 4 ? "" : `${Math.round(2 * (s + 40))}px`;
    const { w, h, ctx } = fitCanvas(this.canvas);
    this.ctx = ctx;
    this.w = w;
    this.h = h;
  }

  show(options: OptionView[], before: Uint8Array, chosen: number, now: number): void {
    this.options = options;
    this.before = before;
    this.chosen = chosen;
    this.t0 = now;
    this.turboRate = 0;
  }

  turbo(boardsPerSecond: number): void {
    this.turboRate = boardsPerSecond;
  }

  draw(now: number): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const opts = this.options;
    if (this.turboRate > 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = C.ink2;
      ctx.font = `italic 400 17px ${F.serif}`;
      const rate = Math.round(this.turboRate / 1000) * 1000;
      ctx.fillText(`Turbo: about ${rate.toLocaleString("en-US")} boards smelled a second.`, this.w / 2, this.h / 2 - 12);
      ctx.font = `400 13px ${F.sans}`;
      ctx.fillStyle = C.ink3;
      ctx.fillText("Pick 1×, 4× or 16× to see each choice.", this.w / 2, this.h / 2 + 14);
      return;
    }
    if (!opts) return;
    const legal = opts.filter((o) => o.legal);
    const lo = Math.min(...legal.map((o) => o.worth));
    const hi = Math.max(...legal.map((o) => o.worth));
    const k = Math.min(1, (now - this.t0) / 280);
    const rows = this.cols === 4 ? 1 : 2;
    const cw = this.w / this.cols;
    const ch = this.h / rows;
    for (let m = 0; m < 4; m++) {
      const o = opts[m];
      const x0 = (m % this.cols) * cw;
      const y0 = Math.floor(m / this.cols) * ch;
      const s = Math.min(cw * 0.42, ch - 12, 150);
      const bx = x0;
      const by = y0 + (ch - s) / 2;
      const chosen = m === this.chosen && this.turboRate === 0;
      const target = legal.length > 1 && o.legal ? (o.worth - lo) / Math.max(1e-6, hi - lo) : o.legal ? 1 : 0;
      this.shown[m] += (target - this.shown[m]) * (k >= 1 ? 1 : 0.18);
      ctx.globalAlpha = this.turboRate > 0 ? 0.35 : o.legal ? 1 : 0.4;
      this.mini(bx, by, s, o.legal ? o.after : this.before, chosen);
      ctx.globalAlpha = 1;

      const tx = bx + s + 14;
      let ty = by + 4;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = o.legal ? C.ink : C.ink3;
      ctx.font = `500 17px ${F.serif}`;
      ctx.fillText(`${ARROWS[m]}  ${NAMES[m]}`, tx, ty);
      ty += 26;
      if (this.turboRate > 0) continue;
      if (!o.legal) {
        ctx.font = `italic 400 14px ${F.serif}`;
        ctx.fillStyle = C.ink3;
        ctx.fillText("can’t move", tx, ty);
        continue;
      }
      ctx.font = `500 15px ${F.mono}`;
      ctx.fillStyle = C.ink;
      const val = `${o.valence >= 0 ? "+" : "−"}${Math.abs(o.valence).toFixed(2)}`;
      ctx.fillText(val, tx, ty - 1);
      const vw = ctx.measureText(val).width;
      if (tx + vw + 56 < x0 + cw - 8) {
        ctx.font = `400 11px ${F.sans}`;
        ctx.fillStyle = C.ink3;
        ctx.fillText("valence", tx + vw + 7, ty + 2);
      }
      ty += 21;
      ctx.font = `400 12px ${F.sans}`;
      ctx.fillStyle = o.sugar ? C.reward : C.ink3;
      const roomy = x0 + cw - tx > 120;
      ctx.fillText(o.sugar ? `+${o.sugar} merge${o.sugar > 1 ? "s" : ""}${roomy ? " (sugar)" : ""}` : "no merge", tx, ty);
      ty += 22;
      // preference among the moves that are possible
      const bw = Math.max(30, Math.min(cw - s - 34, 120));
      ctx.fillStyle = C.faint;
      ctx.fillRect(tx, ty, bw, 4);
      ctx.fillStyle = chosen ? C.accent : C.ink3;
      ctx.fillRect(tx, ty, bw * (0.06 + 0.94 * this.shown[m]), 4);
      if (chosen) {
        ctx.font = `600 11px ${F.sans}`;
        ctx.fillStyle = C.accent;
        ctx.fillText("CHOSEN", tx, ty + 10);
      }
    }
  }

  private mini(x: number, y: number, s: number, b: Uint8Array, chosen: boolean): void {
    const { ctx } = this;
    const gap = s * 0.035;
    const cell = (s - 5 * gap) / 4;
    ctx.fillStyle = C.paper2;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, s * 0.04);
    ctx.fill();
    for (let i = 0; i < CELLS; i++) {
      const cx = x + gap + (i % 4) * (cell + gap);
      const cy = y + gap + Math.floor(i / 4) * (cell + gap);
      if (b[i]) drawTile(ctx, cx, cy, cell, b[i], 1, cell >= 20);
      else {
        ctx.fillStyle = "#ded6c6";
        ctx.beginPath();
        ctx.roundRect(cx, cy, cell, cell, cell * 0.08);
        ctx.fill();
      }
    }
    if (chosen) {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 4, y - 4, s + 8, s + 8, s * 0.05 + 3);
      ctx.stroke();
    }
  }
}
