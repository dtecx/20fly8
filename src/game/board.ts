// 2048 rules on a 4x4 board of exponents (0 = empty, 1 = 2, 2 = 4, ... 11 = 2048).
// A move slides every line towards one edge and merges equal neighbours once, as in the original game.
// Lines are 16-bit words (four 4-bit exponents) and every possible line is precomputed once.

export const SIZE = 4;
export const CELLS = SIZE * SIZE;

export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export type Move = 0 | 1 | 2 | 3;
export const MOVES: readonly Move[] = [UP, RIGHT, DOWN, LEFT];
export const MOVE_NAMES = ["up", "right", "down", "left"] as const;
export const MOVE_ARROWS = ["▲", "▶", "▼", "◀"] as const;

/** cell indices of each line, listed from the edge the tiles slide towards */
const LINES: number[][][] = [
  [0, 1, 2, 3].map((c) => [c, c + 4, c + 8, c + 12]), // up
  [0, 1, 2, 3].map((r) => [r * 4 + 3, r * 4 + 2, r * 4 + 1, r * 4]), // right
  [0, 1, 2, 3].map((c) => [c + 12, c + 8, c + 4, c]), // down
  [0, 1, 2, 3].map((r) => [r * 4, r * 4 + 1, r * 4 + 2, r * 4 + 3]), // left
];

// slide-towards-index-0 result for every 16-bit line
const LINE_OUT = new Uint16Array(1 << 16);
const LINE_SCORE = new Uint32Array(1 << 16);
const LINE_MERGES = new Uint8Array(1 << 16);

(function buildTables() {
  const v = [0, 0, 0, 0];
  for (let line = 0; line < 1 << 16; line++) {
    for (let k = 0; k < 4; k++) v[k] = (line >> (4 * k)) & 15;
    const out: number[] = [];
    let score = 0;
    let merges = 0;
    let k = 0;
    const tiles = v.filter((x) => x > 0);
    while (k < tiles.length) {
      if (k + 1 < tiles.length && tiles[k] === tiles[k + 1] && tiles[k] < 15) {
        const e = tiles[k] + 1;
        out.push(e);
        score += 1 << e;
        merges++;
        k += 2;
      } else {
        out.push(tiles[k]);
        k++;
      }
    }
    while (out.length < 4) out.push(0);
    LINE_OUT[line] = out[0] | (out[1] << 4) | (out[2] << 8) | (out[3] << 12);
    LINE_SCORE[line] = score;
    LINE_MERGES[line] = merges;
  }
})();

export interface MoveResult {
  /** board after sliding, before the new tile appears (the "afterstate") */
  board: Uint8Array;
  /** points gained: the sum of the merged tiles */
  score: number;
  merges: number;
  /** did anything move? Moves that change nothing are not allowed. */
  moved: boolean;
}

/** Slide `board` in direction `move`; writes the afterstate into `out` (may alias `board`). */
export function slide(board: Uint8Array, move: Move, out: Uint8Array = new Uint8Array(CELLS)): MoveResult {
  let score = 0;
  let merges = 0;
  let moved = false;
  const lines = LINES[move];
  for (let l = 0; l < 4; l++) {
    const idx = lines[l];
    const line = board[idx[0]] | (board[idx[1]] << 4) | (board[idx[2]] << 8) | (board[idx[3]] << 12);
    const res = LINE_OUT[line];
    if (res !== line) moved = true;
    score += LINE_SCORE[line];
    merges += LINE_MERGES[line];
    out[idx[0]] = res & 15;
    out[idx[1]] = (res >> 4) & 15;
    out[idx[2]] = (res >> 8) & 15;
    out[idx[3]] = res >> 12;
  }
  return { board: out, score, merges, moved };
}

export function canMove(board: Uint8Array): boolean {
  for (let i = 0; i < CELLS; i++) {
    const v = board[i];
    if (v === 0) return true;
    if (i % 4 < 3 && board[i + 1] === v) return true;
    if (i < 12 && board[i + 4] === v) return true;
  }
  return false;
}

export function maxTile(board: Uint8Array): number {
  let m = 0;
  for (let i = 0; i < CELLS; i++) if (board[i] > m) m = board[i];
  return m;
}

export function emptyCount(board: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (board[i] === 0) n++;
  return n;
}

/** Small fast seedable PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

/** Put a 2 (90 %) or a 4 (10 %) on a random empty cell. Returns the cell, or -1 if the board is full. */
export function spawnTile(board: Uint8Array, rng: Rng): number {
  const n = emptyCount(board);
  if (n === 0) return -1;
  let k = rng.int(n);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== 0) continue;
    if (k-- === 0) {
      board[i] = rng.next() < 0.9 ? 1 : 2;
      return i;
    }
  }
  return -1;
}

export function newBoard(rng: Rng): Uint8Array {
  const b = new Uint8Array(CELLS);
  spawnTile(b, rng);
  spawnTile(b, rng);
  return b;
}

/** Board as text, for logs and tests. */
export function boardToString(board: Uint8Array): string {
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 4; c++) {
      const v = board[r * 4 + c];
      cells.push((v ? String(1 << v) : ".").padStart(5));
    }
    rows.push(cells.join(""));
  }
  return rows.join("\n");
}
