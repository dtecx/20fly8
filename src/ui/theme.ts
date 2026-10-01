// One palette and one set of type for every canvas, matching the CSS tokens in style.css.

export const C = {
  paper: "#f3eee4",
  paper2: "#e9e2d3",
  ink: "#1c1a17",
  ink2: "#4a453d",
  ink3: "#8a8274",
  rule: "#d6cdbd",
  faint: "#e2dacb",
  /** PAM dopamine: better than expected */
  reward: "#1f7a4d",
  /** PPL1 dopamine: worse than expected */
  punish: "#c43d2b",
  /** active Kenyon cells, the chosen option */
  accent: "#c8871e",
};

export const F = {
  serif: `"Newsreader", Georgia, serif`,
  sans: `"IBM Plex Sans", system-ui, sans-serif`,
  mono: `"IBM Plex Mono", ui-monospace, monospace`,
};

/** tile fill and numeral colour by exponent (0 = empty cell) */
export const TILES: { fill: string; text: string }[] = [
  { fill: "#ddd5c5", text: "#8a8274" },
  { fill: "#efe8da", text: "#5b5347" }, // 2
  { fill: "#e8ddc5", text: "#5b5347" }, // 4
  { fill: "#eebb84", text: "#fffaf2" }, // 8
  { fill: "#e89e68", text: "#fffaf2" }, // 16
  { fill: "#e28256", text: "#fffaf2" }, // 32
  { fill: "#d6623d", text: "#fffaf2" }, // 64
  { fill: "#ead08a", text: "#3d3014" }, // 128
  { fill: "#e5c26a", text: "#3d3014" }, // 256
  { fill: "#dfb14c", text: "#3d3014" }, // 512
  { fill: "#cf7f22", text: "#fffaf2" }, // 1024
  { fill: "#1c1a17", text: "#f0cf72" }, // 2048: ink with a gold numeral
  { fill: "#3b2f6a", text: "#f3eee4" }, // 4096
  { fill: "#5a2346", text: "#f3eee4" },
  { fill: "#23314f", text: "#f3eee4" },
  { fill: "#000000", text: "#f3eee4" },
];

export function tileStyle(e: number): { fill: string; text: string } {
  return TILES[Math.min(e, TILES.length - 1)];
}

/** crisp canvas at the device pixel ratio; returns the CSS size */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number; ctx: CanvasRenderingContext2D } {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr, ctx };
}

/** draw a tile with its numeral, centred in the square (x, y, s) */
export function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, e: number, scale = 1, numerals = true): void {
  const st = tileStyle(e);
  const r = Math.max(2, s * 0.075);
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(28, 26, 23, 0.10)";
  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2 + Math.max(1, s * 0.025), s, s, r);
  ctx.fill();
  ctx.fillStyle = st.fill;
  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2, s, s, r);
  ctx.fill();
  if (numerals && s >= 14) {
    const text = String(2 ** e);
    const k = text.length <= 2 ? 0.46 : text.length === 3 ? 0.38 : text.length === 4 ? 0.3 : 0.24;
    ctx.font = `600 ${Math.round(s * k)}px ${F.sans}`;
    ctx.fillStyle = st.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, s * 0.02);
  }
  ctx.restore();
}
