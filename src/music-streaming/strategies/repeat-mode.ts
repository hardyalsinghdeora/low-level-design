export enum RepeatMode {
  OFF = 'OFF',
  ONE = 'ONE',
  ALL = 'ALL',
}

/** Why the player is moving on: the song finished, or the listener pressed next. */
export enum AdvanceReason {
  TRACK_END = 'TRACK_END',
  SKIP = 'SKIP',
}

/**
 * Strategy: given where we are, which queue position plays next.
 * `null` means "nothing left": the player stops.
 */
export interface RepeatStrategy {
  readonly mode: RepeatMode;
  next(position: number, length: number, reason: AdvanceReason): number | null;
  previous(position: number, length: number): number;
}

export class RepeatOff implements RepeatStrategy {
  readonly mode = RepeatMode.OFF;

  next(position: number, length: number): number | null {
    return position + 1 < length ? position + 1 : null;
  }

  previous(position: number): number {
    return Math.max(0, position - 1);
  }
}

/** Replays the current song when it ends, but an explicit skip still moves on. */
export class RepeatOne implements RepeatStrategy {
  readonly mode = RepeatMode.ONE;

  next(position: number, length: number, reason: AdvanceReason): number | null {
    if (reason === AdvanceReason.TRACK_END) return position;
    return position + 1 < length ? position + 1 : null;
  }

  previous(position: number): number {
    return Math.max(0, position - 1);
  }
}

export class RepeatAll implements RepeatStrategy {
  readonly mode = RepeatMode.ALL;

  next(position: number, length: number): number {
    return (position + 1) % length;
  }

  previous(position: number, length: number): number {
    return (position - 1 + length) % length;
  }
}

export function repeatStrategyFor(mode: RepeatMode): RepeatStrategy {
  switch (mode) {
    case RepeatMode.OFF:
      return new RepeatOff();
    case RepeatMode.ONE:
      return new RepeatOne();
    case RepeatMode.ALL:
      return new RepeatAll();
  }
}
