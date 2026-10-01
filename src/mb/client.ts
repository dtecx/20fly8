import type { GameRecord } from "./agent.ts";
import type { FromWorker, ReadyInfo, StepFrame, ToWorker, TurboFrame } from "./protocol.ts";

export interface SavedBrain {
  gains: ArrayBuffer;
  history: GameRecord[];
  totalMoves: number;
  noseSeed: number;
}

/** Main-thread handle to the mushroom-body worker. */
export class MbClient {
  private readonly worker: Worker;
  private nextId = 1;
  pending = false;
  onProgress: (stage: string, frac: number) => void = () => {};
  onStep: (frame: StepFrame) => void = () => {};
  onTurbo: (frame: TurboFrame) => void = () => {};
  onSaved: (brain: SavedBrain) => void = () => {};
  onNose: (nose: Int32Array[], seed: number) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  }

  init(base: string, saved: SavedBrain | null): Promise<ReadyInfo> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
        const msg = ev.data;
        if (msg.type === "progress") this.onProgress(msg.stage, msg.frac);
        else if (msg.type === "ready") resolve(msg.info);
        else if (msg.type === "step") {
          this.pending = false;
          this.onStep(msg.frame);
        } else if (msg.type === "turbo") this.onTurbo(msg.frame);
        else if (msg.type === "saved") this.onSaved({ gains: msg.gains, history: msg.history, totalMoves: msg.totalMoves, noseSeed: msg.noseSeed });
        else if (msg.type === "nose") this.onNose(msg.nose, msg.noseSeed);
        else if (msg.type === "error") {
          this.pending = false;
          this.onError(msg.message);
          reject(new Error(msg.message));
        }
      };
      this.worker.onerror = (e) => {
        this.onError(e.message);
        reject(new Error(e.message));
      };
      const gains = saved ? saved.gains.slice(0) : null;
      this.send(
        {
          type: "init",
          base,
          gains,
          history: saved?.history ?? [],
          totalMoves: saved?.totalMoves ?? 0,
          noseSeed: saved?.noseSeed ?? 2048,
        },
        gains ? [gains] : [],
      );
    });
  }

  step(): void {
    this.pending = true;
    this.send({ type: "step", id: this.nextId++ });
  }

  turbo(on: boolean): void {
    this.send({ type: "turbo", on });
  }

  learning(on: boolean): void {
    this.send({ type: "learning", on });
  }

  shuffle(seed: number): void {
    this.send({ type: "shuffle", seed });
  }

  reset(): void {
    this.send({ type: "reset" });
  }

  save(): void {
    this.send({ type: "save" });
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }
}

// --- persistence: the fly keeps what it learned (IndexedDB, per browser) ---

const DB = "20fly8";
const STORE = "brain";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadBrain(): Promise<SavedBrain | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get("current");
      req.onsuccess = () => resolve((req.result as SavedBrain | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function storeBrain(brain: SavedBrain): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(brain, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* private mode or storage blocked: the fly just starts naive next time */
  }
}

export async function forgetBrain(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete("current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* nothing stored */
  }
}
