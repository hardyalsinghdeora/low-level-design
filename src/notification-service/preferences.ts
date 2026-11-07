import { Channel } from './channel';
import { InvalidConfigurationError, UnknownUserError } from './errors';

const DAY_MS = 24 * 60 * 60 * 1_000;

function parseTime(text: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) throw new InvalidConfigurationError(`Quiet hours must be HH:MM, got "${text}"`);
  return (Number(match[1]) * 60 + Number(match[2])) * 60_000;
}

/**
 * A daily do-not-disturb window in the user's local time, given as a fixed
 * UTC offset so the logic needs no time-zone database. Windows may cross
 * midnight (22:00 to 07:00).
 */
export class QuietHours {
  private readonly startMs: number;
  private readonly endMs: number;

  constructor(
    start: string,
    end: string,
    private readonly utcOffsetMinutes = 0,
  ) {
    this.startMs = parseTime(start);
    this.endMs = parseTime(end);
    if (this.startMs === this.endMs) throw new InvalidConfigurationError('Quiet hours start and end must differ');
  }

  isQuiet(at: Date): boolean {
    const local = this.localMs(at);
    return this.startMs < this.endMs
      ? local >= this.startMs && local < this.endMs
      : local >= this.startMs || local < this.endMs;
  }

  /** `at` itself when not quiet, otherwise the moment the window ends. */
  nextAllowed(at: Date): Date {
    if (!this.isQuiet(at)) return at;
    const wait = (this.endMs - this.localMs(at) + DAY_MS) % DAY_MS;
    return new Date(at.getTime() + wait);
  }

  private localMs(at: Date): number {
    return (((at.getTime() + this.utcOffsetMinutes * 60_000) % DAY_MS) + DAY_MS) % DAY_MS;
  }
}

export interface UserPreferencesInput {
  userId: string;
  email?: string;
  phone?: string;
  deviceToken?: string;
  optOuts?: Channel[];
  quietHours?: QuietHours;
}

/** A user's addresses and choices. The service asks it; it never decides delivery itself. */
export class UserPreferences {
  readonly userId: string;
  readonly quietHours: QuietHours | undefined;
  private readonly addresses: Partial<Record<Channel, string>>;
  private readonly optOuts: Set<Channel>;

  constructor(input: UserPreferencesInput) {
    this.userId = input.userId;
    this.quietHours = input.quietHours;
    this.addresses = { [Channel.EMAIL]: input.email, [Channel.SMS]: input.phone, [Channel.PUSH]: input.deviceToken };
    this.optOuts = new Set(input.optOuts ?? []);
  }

  addressFor(channel: Channel): string | undefined {
    return this.addresses[channel];
  }

  hasOptedOut(channel: Channel): boolean {
    return this.optOuts.has(channel);
  }

  optOut(channel: Channel): void {
    this.optOuts.add(channel);
  }

  optIn(channel: Channel): void {
    this.optOuts.delete(channel);
  }
}

export class PreferenceStore {
  private readonly users = new Map<string, UserPreferences>();

  upsert(preferences: UserPreferences): this {
    this.users.set(preferences.userId, preferences);
    return this;
  }

  get(userId: string): UserPreferences {
    const preferences = this.users.get(userId);
    if (!preferences) throw new UnknownUserError(userId);
    return preferences;
  }
}
