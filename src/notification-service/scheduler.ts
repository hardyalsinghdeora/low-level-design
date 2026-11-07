interface Job {
  readonly runAt: number;
  readonly seq: number;
  readonly notificationId: string;
}

/**
 * A delay queue standing in for SQS delay messages or a jobs table. Nothing
 * runs by itself: whoever owns the loop (a worker, the test) calls takeDue().
 * Jobs due at the same instant come out in the order they were scheduled.
 */
export class ScheduledQueue {
  private jobs: Job[] = [];
  private seq = 0;

  schedule(runAt: Date, notificationId: string): void {
    this.seq += 1;
    this.jobs.push({ runAt: runAt.getTime(), seq: this.seq, notificationId });
    this.jobs.sort((a, b) => a.runAt - b.runAt || a.seq - b.seq);
  }

  takeDue(now: Date): string[] {
    const cut = this.jobs.findIndex((job) => job.runAt > now.getTime());
    const due = cut < 0 ? this.jobs : this.jobs.slice(0, cut);
    this.jobs = cut < 0 ? [] : this.jobs.slice(cut);
    return due.map((job) => job.notificationId);
  }

  nextRunAt(): Date | undefined {
    const first = this.jobs[0];
    return first ? new Date(first.runAt) : undefined;
  }

  get size(): number {
    return this.jobs.length;
  }
}
