// The fly plays: before every move it smells the four boards it could make, picks the most attractive one, and
// dopamine reports how much better or worse things turned out than that smell had promised.
import { canMove, CELLS, maxTile, MOVES, newBoard, Rng, slide, spawnTile, type Move } from "../game/board.ts";
import { KcCode, type MushroomBody } from "./model.ts";

export interface Option {
  move: Move;
  legal: boolean;
  /** the board this move would make, before the new tile */
  after: Uint8Array;
  /** merges this move would make: one sip of sugar each */
  sugar: number;
  points: number;
  code: KcCode;
  /** what the mushroom body thinks of the smell of `after` */
  valence: number;
  /** sugar now + discounted valence: what the choice is based on */
  worth: number;
}

export interface StepResult {
  move: Move;
  /** board before the move */
  before: Uint8Array;
  /** board after the move and the new tile */
  board: Uint8Array;
  spawnCell: number;
  sugar: number;
  points: number;
  /** reward-prediction error delivered to the dopamine neurons for the previous choice */
  dopamine: number;
  synapsesChanged: number;
  gameOver: boolean;
}

export interface GameRecord {
  game: number;
  score: number;
  /** exponent of the largest tile */
  maxTile: number;
  moves: number;
  learning: boolean;
}

export class FlyAgent {
  readonly mb: MushroomBody;
  readonly rng: Rng;
  board: Uint8Array;
  score = 0;
  moves = 0;
  game = 1;
  /** dopamine on: the synapses learn */
  learning = true;
  readonly options: Option[];
  private readonly prev: KcCode;
  private prevValence = 0;
  private havePrev = false;
  readonly history: GameRecord[] = [];
  totalMoves = 0;

  constructor(mb: MushroomBody, seed = 1) {
    this.mb = mb;
    this.rng = new Rng(seed);
    this.board = newBoard(this.rng);
    const cap = mb.c.kc.n;
    this.options = MOVES.map((move) => ({
      move,
      legal: false,
      after: new Uint8Array(CELLS),
      sugar: 0,
      points: 0,
      code: new KcCode(cap),
      valence: 0,
      worth: -Infinity,
    }));
    this.prev = new KcCode(cap);
  }

  /** Smell all four options of the current board (also used for display). Returns the best move, or -1. */
  evaluate(): Move | -1 {
    const { mb } = this;
    const gamma = mb.p.gamma;
    let best: Move | -1 = -1;
    let bestWorth = -Infinity;
    let ties = 0;
    for (const o of this.options) {
      const r = slide(this.board, o.move, o.after);
      o.legal = r.moved;
      o.sugar = r.merges;
      o.points = r.score;
      if (!o.legal) {
        o.code.n = 0;
        o.code.z = 0;
        o.valence = 0;
        o.worth = -Infinity;
        continue;
      }
      mb.code(o.after, o.code);
      o.valence = mb.valence(o.code);
      o.worth = o.sugar + gamma * o.valence;
      if (o.worth > bestWorth) {
        bestWorth = o.worth;
        best = o.move;
        ties = 1;
      } else if (o.worth === bestWorth && this.rng.int(++ties) === 0) best = o.move;
    }
    return best;
  }

  /** One move: smell, choose, learn from the previous choice, act, and let a new tile appear. */
  step(): StepResult {
    let choice = this.evaluate();
    if (choice < 0) {
      // the last game ended: start the next one
      this.newGame();
      choice = this.evaluate();
    }
    const best = choice as Move;
    const before = this.board.slice();
    const o = this.options[best];
    let dopamine = 0;
    let changed = 0;
    if (this.havePrev) {
      dopamine = o.sugar + this.mb.p.gamma * o.valence - this.prevValence;
      if (this.learning) changed = this.mb.dopamine(this.prev, dopamine);
    }
    this.board = o.after.slice();
    this.score += o.points;
    this.moves++;
    this.totalMoves++;
    const spawnCell = spawnTile(this.board, this.rng);
    this.prev.copyFrom(o.code);
    this.prevValence = this.mb.valence(this.prev);
    this.havePrev = true;

    let gameOver = false;
    if (!canMove(this.board)) {
      // the end: whatever the last smell promised, nothing more comes
      const d = -this.prevValence;
      if (this.learning) changed += this.mb.dopamine(this.prev, d);
      dopamine = d;
      gameOver = true;
      this.history.push({ game: this.game, score: this.score, maxTile: maxTile(this.board), moves: this.moves, learning: this.learning });
    }
    return { move: best, before, board: this.board, spawnCell, sugar: o.sugar, points: o.points, dopamine, synapsesChanged: changed, gameOver };
  }

  newGame(): void {
    this.board = newBoard(this.rng);
    this.score = 0;
    this.moves = 0;
    this.game++;
    this.havePrev = false;
  }
}
