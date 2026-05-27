import { runHistoricalBackfill, type BackfillEvent, type Signal } from "./backfill";

export type JobStatus = "idle" | "running" | "paused" | "rate_limit" | "daily_limit" | "done";

export interface JobState {
  status:   JobStatus;
  done:     number;
  total:    number;
  errors:   number;
  waitMs?:  number; // set while waiting on a rate limit
}

interface Job extends JobState {
  signal:    Signal;
  listeners: Set<(event: BackfillEvent) => void>;
}

class BackfillRunner {
  private jobs = new Map<string, Job>();

  private ensure(userId: string): Job {
    if (!this.jobs.has(userId)) {
      this.jobs.set(userId, {
        status: "idle", done: 0, total: 0, errors: 0,
        signal: "none", listeners: new Set(),
      });
    }
    return this.jobs.get(userId)!;
  }

  getStatus(userId: string): JobState {
    const j = this.jobs.get(userId);
    if (!j) return { status: "idle", done: 0, total: 0, errors: 0 };
    return { status: j.status, done: j.done, total: j.total, errors: j.errors, waitMs: j.waitMs };
  }

  subscribe(userId: string, cb: (event: BackfillEvent) => void) {
    this.ensure(userId).listeners.add(cb);
  }

  unsubscribe(userId: string, cb: (event: BackfillEvent) => void) {
    this.jobs.get(userId)?.listeners.delete(cb);
  }

  private emit(userId: string, event: BackfillEvent) {
    this.jobs.get(userId)?.listeners.forEach(cb => { try { cb(event); } catch { /* listener gone */ } });
  }

  start(userId: string) {
    const job = this.ensure(userId);
    if (job.status === "running" || job.status === "paused" || job.status === "rate_limit" || job.status === "daily_limit") return;

    job.signal = "none";
    job.status = "running";
    job.done   = 0;
    job.total  = 0;
    job.errors = 0;
    delete job.waitMs;

    void runHistoricalBackfill(
      userId,
      (event) => {
        if (event.type === "start") {
          job.total = event.total;
        } else if (event.type === "progress") {
          job.done = event.done; job.total = event.total; job.errors = event.errors;
          job.status = "running"; delete job.waitMs;
        } else if (event.type === "rate_limit") {
          job.done = event.done; job.total = event.total; job.errors = event.errors;
          job.status = "rate_limit"; job.waitMs = event.waitMs;
        } else if (event.type === "daily_limit") {
          job.done = event.done; job.total = event.total; job.errors = event.errors;
          job.status = "daily_limit"; job.waitMs = event.waitMs;
        } else if (event.type === "paused") {
          job.status = "paused"; job.done = event.done; job.errors = event.errors; delete job.waitMs;
        } else if (event.type === "resumed") {
          job.status = "running"; delete job.waitMs;
        } else if (event.type === "stopped") {
          job.status = "idle"; job.done = event.done; job.total = event.total; job.errors = event.errors; delete job.waitMs;
        } else if (event.type === "done") {
          job.status = "done"; job.done = event.done; job.total = event.total; job.errors = event.errors; delete job.waitMs;
        }
        this.emit(userId, event);
      },
      () => job.signal,
    ).catch(() => { job.status = "idle"; delete job.waitMs; });
  }

  pause(userId: string) {
    const j = this.jobs.get(userId);
    if (j?.status === "running" || j?.status === "rate_limit" || j?.status === "daily_limit") {
      j.signal = "pause";
    }
  }

  resume(userId: string) {
    const j = this.jobs.get(userId);
    if (j?.status === "paused") {
      j.signal = "none";
      j.status = "running"; // optimistic — loop confirms via "resumed" event
    }
  }

  stop(userId: string) {
    const j = this.jobs.get(userId);
    if (j && j.status !== "idle" && j.status !== "done") j.signal = "stop";
  }
}

// Survive Next.js hot-reloads
const g = globalThis as typeof globalThis & { __backfillRunner?: BackfillRunner };
export const backfillRunner = g.__backfillRunner ??= new BackfillRunner();
