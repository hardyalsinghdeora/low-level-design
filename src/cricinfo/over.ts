import type { Ball } from './ball';
import { NoActiveOverError } from './errors';

export const BALLS_PER_OVER = 6;

/** Six legal deliveries by one bowler. Wides and no-balls are added but do not count towards the six. */
export class Over {
  private readonly _balls: Ball[] = [];

  constructor(
    readonly index: number,
    readonly bowlerId: string,
  ) {}

  get balls(): readonly Ball[] {
    return this._balls;
  }

  get legalBalls(): number {
    return this._balls.filter((ball) => ball.isLegal).length;
  }

  get isComplete(): boolean {
    return this.legalBalls >= BALLS_PER_OVER;
  }

  get runsConceded(): number {
    return this._balls.reduce((sum, ball) => sum + ball.runsConceded, 0);
  }

  get isMaiden(): boolean {
    return this.isComplete && this.runsConceded === 0;
  }

  add(ball: Ball): void {
    if (this.isComplete) throw new NoActiveOverError();
    this._balls.push(ball);
  }
}
