// Panel d: the score of every game the fly has played, with the running mean and the first big tiles marked.
import type { GameRecord } from "../mb/agent.ts";
import { C, F, fitCanvas, tileStyle } from "./theme.ts";

/** mean score of uniformly random moves over 2,000 games (scripts/eval.ts) */
export const RANDOM_MEAN = 1067;
const WINDOW = 50;

export interface Marker {
  /** index of the first game after the event */
  game: number;
  label: string;
}

function dotColor(e: number): string {
  if (e <= 8) return "#b9b0a0";
  return tileStyle(Math.min(e, 12)).fill;
}

export class CurveView {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private history: GameRecord[] = [];
  private markers: Marker[] = [];
  private dirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const { w, h, ctx } = fitCanvas(this.canvas);
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.dirty = true;
  }

  set(history: GameRecord[], markers: Marker[]): void {
    this.history = history;
    this.markers = markers;
    this.dirty = true;
  }

  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const left = 46;
    const right = 14;
    const top = 22;
    const bottom = 24;
    const pw = w - left - right;
    const ph = h - top - bottom;
    if (ph < 40) return;
    const lo = Math.log10(250);
    const hi = Math.log10(60000);
    const yOf = (s: number) => top + ph - ((Math.log10(Math.min(60000, Math.max(250, s))) - lo) / (hi - lo)) * ph;
    const n = this.history.length;
    const span = Math.max(n, 40);
    const xOf = (i: number) => left + (pw * (i + 0.5)) / span;

    // grid
    ctx.font = `400 11px ${F.mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const t of [500, 1000, 2000, 5000, 10000, 20000, 50000]) {
      const y = Math.round(yOf(t)) + 0.5;
      ctx.strokeStyle = C.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + pw, y);
      ctx.stroke();
      ctx.fillStyle = C.ink3;
      ctx.fillText(t >= 1000 ? `${t / 1000}k` : String(t), left - 8, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.ink3;
    ctx.font = `400 12px ${F.sans}`;
    ctx.fillText("score per game (log scale)", left, 12);

    // random moves for comparison
    const yr = Math.round(yOf(RANDOM_MEAN)) + 0.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = C.ink3;
    ctx.beginPath();
    ctx.moveTo(left, yr);
    ctx.lineTo(left + pw, yr);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "right";
    ctx.font = `italic 400 13px ${F.serif}`;
    ctx.fillStyle = C.ink2;
    ctx.fillText("random moves", left + pw, yr - 6);

    // legend
    ctx.font = `400 12px ${F.sans}`;
    let lx = left + pw;
    for (const [e, label] of [
      [11, "2048"],
      [10, "1024"],
      [9, "512"],
      [8, "≤ 256"],
    ] as const) {
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = C.ink2;
      ctx.textAlign = "right";
      ctx.fillText(label, lx, 12);
      ctx.fillStyle = dotColor(e);
      ctx.beginPath();
      ctx.arc(lx - tw - 8, 8, 4, 0, Math.PI * 2);
      ctx.fill();
      lx -= tw + 26;
    }
    ctx.fillStyle = C.ink3;
    ctx.textAlign = "right";
    ctx.fillText("largest tile:", lx, 12);

    if (n === 0) {
      ctx.textAlign = "center";
      ctx.font = `italic 400 15px ${F.serif}`;
      ctx.fillStyle = C.ink3;
      ctx.fillText("The first game is still on.", left + pw / 2, top + ph * 0.4);
      return;
    }

    // stretches without dopamine
    ctx.fillStyle = "rgba(196, 61, 43, 0.08)";
    for (let i = 0; i < n; i++) {
      if (this.history[i].learning) continue;
      let j = i;
      while (j + 1 < n && !this.history[j + 1].learning) j++;
      ctx.fillRect(xOf(i) - pw / span / 2, top, xOf(j) - xOf(i) + pw / span, ph);
      ctx.fillStyle = C.punish;
      ctx.font = `400 11px ${F.sans}`;
      ctx.textAlign = "left";
      ctx.fillText("dopamine blocked", xOf(i) + 2, top + 12);
      ctx.fillStyle = "rgba(196, 61, 43, 0.08)";
      i = j;
    }
    for (const m of this.markers) {
      if (m.game >= n) continue;
      const x = Math.round(xOf(m.game) - pw / span / 2) + 0.5;
      ctx.strokeStyle = C.ink3;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.ink2;
      ctx.font = `400 11px ${F.sans}`;
      ctx.textAlign = "left";
      ctx.fillText(m.label, x + 4, top + ph - 6);
    }

    // every game
    const r = n > 2000 ? 1.4 : n > 400 ? 2 : 2.8;
    const stride = Math.max(1, Math.floor(n / 4000));
    for (let i = 0; i < n; i++) {
      const g = this.history[i];
      if (i % stride && g.maxTile < 10) continue;
      ctx.fillStyle = dotColor(g.maxTile);
      ctx.globalAlpha = g.maxTile <= 8 ? 0.55 : 0.9;
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(g.score), g.maxTile >= 11 ? r + 1.6 : r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // running mean
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let sum = 0;
    const step = Math.max(1, Math.floor(n / 800));
    for (let i = 0; i < n; i++) {
      sum += this.history[i].score;
      if (i >= WINDOW) sum -= this.history[i - WINDOW].score;
      if (i % step && i !== n - 1) continue;
      const y = yOf(sum / Math.min(i + 1, WINDOW));
      if (i === 0) ctx.moveTo(xOf(i), y);
      else ctx.lineTo(xOf(i), y);
    }
    ctx.stroke();

    // firsts
    const firsts: [number, number][] = [];
    for (const e of [9, 10, 11, 12]) {
      const i = this.history.findIndex((g) => g.maxTile >= e);
      if (i >= 0) firsts.push([e, i]);
    }
    ctx.font = `400 11px ${F.sans}`;
    let lastX = -1e9;
    for (const [e, i] of firsts) {
      const x = xOf(i);
      const y = yOf(this.history[i].score);
      const ly = top + 30 + (x - lastX < 90 ? 14 : 0);
      ctx.strokeStyle = C.ink3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, ly + 4);
      ctx.stroke();
      ctx.fillStyle = C.ink2;
      ctx.textAlign = x > left + pw - 90 ? "right" : "left";
      ctx.fillText(`first ${2 ** e} · game ${i + 1}`, x + (ctx.textAlign === "right" ? -4 : 4), ly);
      lastX = x;
    }

    // x axis
    ctx.fillStyle = C.ink3;
    ctx.font = `400 11px ${F.mono}`;
    ctx.textAlign = "left";
    ctx.fillText("game 1", left, top + ph + 16);
    ctx.textAlign = "right";
    ctx.fillText(`game ${n.toLocaleString("en-US")}`, left + pw, top + ph + 16);
  }
}
