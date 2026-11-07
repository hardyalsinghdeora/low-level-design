import {
  Game,
  GameStatus,
  LineKind,
  type MoveOutcome,
  Player,
  PlayerSymbol,
  RandomMoveStrategy,
  type WinningLine,
} from './index';

function show(game: Game): void {
  for (const line of game.board.toString().split('\n')) console.log(`    ${line}`);
}

function lineName(line: WinningLine): string {
  return line.kind === LineKind.ROW || line.kind === LineKind.COLUMN ? `${line.kind} ${line.index}` : line.kind;
}

function describeOutcome({ move, status, winner, winningLine }: MoveOutcome): string {
  const played = `#${move.number} ${move.player.name} (${move.player.symbol}) -> (${move.position.row}, ${move.position.col})`;
  return winner && winningLine ? `${played}  ${status} on ${lineName(winningLine)}` : `${played}  ${status}`;
}

function attempt(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  }
}

/** Replays a fixed list of "random" numbers so the bot match prints the same every run. */
function scriptedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const asha = new Player('Asha', PlayerSymbol.X);
const ravi = new Player('Ravi', PlayerSymbol.O);
const game = new Game(asha, ravi);

console.log('\n--- 3x3: Asha (X) and Ravi (O) take turns ---');
console.log(`  ${describeOutcome(game.makeMove(asha, 1, 1))}`);
console.log(`  ${describeOutcome(game.makeMove(ravi, 0, 0))}`);
console.log(`  ${describeOutcome(game.makeMove(asha, 0, 2))}`);
show(game);

console.log('\n--- Two illegal moves are refused and change nothing ---');
attempt(() => game.makeMove(asha, 2, 2));
attempt(() => game.makeMove(ravi, 1, 1));

console.log('\n--- Ravi misses the threat; Asha completes the anti-diagonal ---');
console.log(`  ${describeOutcome(game.makeMove(ravi, 0, 1))}`);
console.log(`  ${describeOutcome(game.makeMove(asha, 2, 0))}`);
show(game);
attempt(() => game.makeMove(ravi, 2, 2));

console.log('\n--- Ravi asks for a takeback: undo reopens the game and rolls the counters back ---');
const undone = game.undo();
console.log(`  undid #${undone.number}; status=${game.status}, next=${game.currentPlayer.name}`);
console.log(`  X holds ${game.lineCounts(PlayerSymbol.X).antiDiagonal} of 3 anti-diagonal cells again`);

console.log('\n--- Two bots on a 4x4 board (RandomMoveStrategy, scripted rng) ---');
const botGame = new Game(
  new Player('Bot-X', PlayerSymbol.X, new RandomMoveStrategy(scriptedRng([0.1, 0.7, 0.35]))),
  new Player('Bot-O', PlayerSymbol.O, new RandomMoveStrategy(scriptedRng([0.95, 0.5]))),
  { size: 4 },
);
while (botGame.status === GameStatus.IN_PROGRESS) botGame.playTurn();
show(botGame);
const result = botGame.winner && botGame.winningLine ? `${botGame.winner.name} wins on ${lineName(botGame.winningLine)}` : 'nobody wins';
console.log(`  ${botGame.status} after ${botGame.moves.length} moves: ${result}`);
