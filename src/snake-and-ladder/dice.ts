export interface DiceRoll {
  /** The face shown by each die. */
  readonly faces: readonly number[];
  readonly total: number;
}

/**
 * Strategy pattern: where a roll comes from. The game never calls
 * Math.random itself, so tests and replays can script every roll.
 */
export interface Dice {
  roll(): DiceRoll;
}

export interface RandomDiceOptions {
  /** How many dice are thrown together; their faces are summed. */
  count?: number;
  sides?: number;
  /** Returns a number in [0, 1). Defaults to Math.random. */
  rng?: () => number;
}

/** `count` fair dice with `sides` faces each. */
export class RandomDice implements Dice {
  readonly count: number;
  readonly sides: number;
  private readonly rng: () => number;

  constructor(options: RandomDiceOptions = {}) {
    this.count = options.count ?? 1;
    this.sides = options.sides ?? 6;
    this.rng = options.rng ?? Math.random;
    if (!Number.isInteger(this.count) || this.count < 1) throw new RangeError(`count must be >= 1, got ${this.count}`);
    if (!Number.isInteger(this.sides) || this.sides < 2) throw new RangeError(`sides must be >= 2, got ${this.sides}`);
  }

  roll(): DiceRoll {
    const faces = Array.from({ length: this.count }, () => 1 + Math.min(this.sides - 1, Math.floor(this.rng() * this.sides)));
    return { faces, total: faces.reduce((sum, face) => sum + face, 0) };
  }
}

/** Replays a fixed list of rolls (a number, or the faces of several dice). For tests, demos and replays. */
export class ScriptedDice implements Dice {
  private readonly rolls: number[][];

  constructor(rolls: ReadonlyArray<number | readonly number[]>) {
    this.rolls = rolls.map((roll) => (typeof roll === 'number' ? [roll] : [...roll]));
    for (const faces of this.rolls) {
      if (faces.length === 0 || faces.some((face) => !Number.isInteger(face) || face < 1)) {
        throw new RangeError(`Every scripted face must be a positive integer, got [${faces.join(', ')}]`);
      }
    }
  }

  get remaining(): number {
    return this.rolls.length;
  }

  roll(): DiceRoll {
    const faces = this.rolls.shift();
    if (!faces) throw new RangeError('ScriptedDice has run out of rolls');
    return { faces, total: faces.reduce((sum, face) => sum + face, 0) };
  }
}
