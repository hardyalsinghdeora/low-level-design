import { NotFoundError } from './errors';

export interface Player {
  id: string;
  name: string;
}

/** A squad in batting order. The order matters: the next batter in is the next player in the list. */
export class Team {
  private readonly _players: Player[];

  constructor(
    readonly id: string,
    readonly name: string,
    players: readonly Player[],
  ) {
    if (players.length < 2) throw new RangeError('a team needs at least two players to bat');
    if (new Set(players.map((p) => p.id)).size !== players.length) throw new RangeError('duplicate player ids');
    this._players = [...players];
  }

  get players(): readonly Player[] {
    return this._players;
  }

  has(playerId: string): boolean {
    return this._players.some((p) => p.id === playerId);
  }

  player(playerId: string): Player {
    const player = this._players.find((p) => p.id === playerId);
    if (!player) throw new NotFoundError(`player in ${this.name}`, playerId);
    return player;
  }
}
