import { START_CELL } from './board';

/** A token on the board. It only knows where it stands; the game decides where it goes. */
export class Player {
  private _position = START_CELL;

  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    if (!name.trim()) throw new RangeError('name is required');
  }

  get position(): number {
    return this._position;
  }

  moveTo(cell: number): void {
    if (!Number.isInteger(cell) || cell < START_CELL) throw new RangeError(`Cannot move ${this.name} to cell ${cell}`);
    this._position = cell;
  }
}
