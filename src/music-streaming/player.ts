import { Clock, SystemClock } from '../shared/clock';
import type { Song } from './catalog';
import { AdInProgressError, EmptyQueueError, InvalidPlayerTransitionError, SkipLimitReachedError } from './errors';
import type { ListeningHistory } from './listening-history';
import { PlayQueue } from './play-queue';
import { AdvanceReason, RepeatMode, repeatStrategyFor, type RepeatStrategy } from './strategies/repeat-mode';
import type { TierPolicy } from './strategies/tier';

export enum PlayerState {
  STOPPED = 'STOPPED',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
}

const TRANSITIONS: Record<PlayerState, readonly PlayerState[]> = {
  [PlayerState.STOPPED]: [PlayerState.PLAYING],
  [PlayerState.PLAYING]: [PlayerState.PAUSED, PlayerState.STOPPED],
  [PlayerState.PAUSED]: [PlayerState.PLAYING, PlayerState.STOPPED],
};

/** Pressing "previous" this far into a song restarts it instead of going back. */
const RESTART_THRESHOLD_SEC = 3;

export interface PlayerOptions {
  clock?: Clock;
  rng?: () => number;
  repeat?: RepeatMode;
}

/**
 * One listener's playback. It owns the state machine, the queue and the
 * playback position; repeat behaviour and tier rules are injected
 * strategies. Time never passes on its own: `tick(seconds)` advances the
 * position, which keeps tests deterministic and the domain free of timers.
 */
export class Player {
  private _state = PlayerState.STOPPED;
  private readonly queue = new PlayQueue();
  private repeat: RepeatStrategy;
  private _positionSec = 0;
  private adRemainingSec = 0;
  private songsSinceAd = 0;
  private _adsPlayed = 0;
  private readonly skipTimes: Date[] = [];
  private readonly clock: Clock;
  private readonly rng: () => number;

  constructor(
    readonly listenerId: string,
    private readonly tier: TierPolicy,
    private readonly history: ListeningHistory,
    options: PlayerOptions = {},
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.rng = options.rng ?? Math.random;
    this.repeat = repeatStrategyFor(options.repeat ?? RepeatMode.OFF);
  }

  get state(): PlayerState {
    return this._state;
  }

  get current(): Song | null {
    return this.queue.current;
  }

  get positionSec(): number {
    return this._positionSec;
  }

  get isAdPlaying(): boolean {
    return this.adRemainingSec > 0;
  }

  get adsPlayed(): number {
    return this._adsPlayed;
  }

  get repeatMode(): RepeatMode {
    return this.repeat.mode;
  }

  get skipsRemaining(): number {
    return this.tier.skipsRemaining(this.skipTimes, this.clock.now());
  }

  upcoming(): Song[] {
    return this.queue.upcoming();
  }

  load(songs: readonly Song[], startIndex = 0): void {
    if (this._state !== PlayerState.STOPPED) this.transition(PlayerState.STOPPED);
    this.queue.load(songs, startIndex);
    this._positionSec = 0;
    this.adRemainingSec = 0;
  }

  play(): void {
    if (this.queue.length === 0) throw new EmptyQueueError();
    this.transition(PlayerState.PLAYING);
  }

  pause(): void {
    this.transition(PlayerState.PAUSED);
  }

  stop(): void {
    this.transition(PlayerState.STOPPED);
    this._positionSec = 0;
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = repeatStrategyFor(mode);
  }

  setShuffle(on: boolean): void {
    if (on) this.queue.shuffle(this.rng);
    else this.queue.unshuffle();
  }

  /** Listener pressed next: subject to the tier's skip budget. */
  next(): Song | null {
    this.requireControllable();
    const now = this.clock.now();
    if (this.tier.skipsRemaining(this.skipTimes, now) <= 0) {
      throw new SkipLimitReachedError(this.listenerId, this.tier.maxSkipsPerHour);
    }
    this.skipTimes.push(now);
    return this.advance(AdvanceReason.SKIP);
  }

  previous(): Song | null {
    this.requireControllable();
    if (this._positionSec < RESTART_THRESHOLD_SEC) {
      this.queue.moveTo(this.repeat.previous(this.queue.position, this.queue.length));
    }
    this._positionSec = 0;
    return this.queue.current;
  }

  /** Advances playback time; finishes songs and ad breaks as their time runs out. */
  tick(seconds: number): void {
    let left = seconds;
    while (left > 0 && this._state === PlayerState.PLAYING) {
      if (this.adRemainingSec > 0) {
        const used = Math.min(left, this.adRemainingSec);
        this.adRemainingSec -= used;
        left -= used;
        continue;
      }
      const song = this.queue.current;
      if (!song) return;
      const remaining = song.durationSec - this._positionSec;
      if (left < remaining) {
        this._positionSec += left;
        return;
      }
      left -= remaining;
      this.finish(song);
    }
  }

  private finish(song: Song): void {
    this.history.record(this.listenerId, song, this.clock.now());
    this.songsSinceAd += 1;
    const next = this.advance(AdvanceReason.TRACK_END);
    if (next && this.tier.adDue(this.songsSinceAd)) {
      this.adRemainingSec = this.tier.adDurationSec;
      this.songsSinceAd = 0;
      this._adsPlayed += 1;
    }
  }

  private advance(reason: AdvanceReason): Song | null {
    this._positionSec = 0;
    const next = this.repeat.next(this.queue.position, this.queue.length, reason);
    if (next === null) {
      this.queue.moveTo(0);
      if (this._state !== PlayerState.STOPPED) this.transition(PlayerState.STOPPED);
      return null;
    }
    this.queue.moveTo(next);
    return this.queue.current;
  }

  private requireControllable(): void {
    if (this.queue.length === 0) throw new EmptyQueueError();
    if (this.isAdPlaying) throw new AdInProgressError();
  }

  private transition(next: PlayerState): void {
    if (!TRANSITIONS[this._state].includes(next)) throw new InvalidPlayerTransitionError(this._state, next);
    this._state = next;
  }
}
