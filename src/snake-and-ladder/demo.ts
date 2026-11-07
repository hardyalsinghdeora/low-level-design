import { SequentialIdGenerator } from '../shared/id-generator';
import { Board, describeMove, Game, GameStatus, Ladder, RandomDice, ScriptedDice, Snake } from './index';

function attempt(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  }
}

const jumps = [new Ladder(4, 14), new Ladder(9, 21), new Snake(16, 6), new Snake(28, 10)];

console.log('\n--- Setting up a 30-cell board ---');
console.log(`  ${jumps.map((jump) => jump.describe()).join(', ')}`);
console.log('  A snake from 21 would chain off the ladder 9->21, so that board is refused:');
attempt(() => new Board(30, [...jumps, new Snake(21, 3)]));

// Scripted rolls make the story identical on every run; production code would use RandomDice.
const game = new Game(new Board(30, jumps), {
  dice: new ScriptedDice([3, 5, 6, 2, 3, 4, 6, 6, 6, 5, 5, 6, 1, 3]),
  ids: new SequentialIdGenerator(),
});
for (const name of ['Asha', 'Ravi', 'Meera']) game.addPlayer(name);

console.log('\n--- Asha, Ravi and Meera join; rolling before start() is refused ---');
attempt(() => game.playTurn());
game.start();
console.log(`  status=${game.status}, first up: ${game.currentPlayer?.name}`);

console.log('\n--- Turns (front of the queue plays, then goes to the back) ---');
while (game.status === GameStatus.IN_PROGRESS) {
  const result = game.playTurn();
  console.log(`  #${String(result.turn).padStart(2)} ${describeMove(result)}`);
}

console.log('\n--- Game over ---');
console.log(`  status=${game.status}, winner=${game.winner?.name}`);
for (const standing of game.ranking()) {
  console.log(`  ${standing.place}. ${standing.player.name} on ${standing.position}`);
}
console.log('  One more roll is refused:');
attempt(() => game.playTurn());

console.log('\n--- Two dice with a seeded rng (the multi-dice option) ---');
const values = [0.42, 0.9, 0.05, 0.6, 0.99, 0.31];
const twoDice = new RandomDice({ count: 2, rng: () => values.shift() ?? 0 });
for (let i = 0; i < 3; i += 1) {
  const roll = twoDice.roll();
  console.log(`  rolled ${roll.faces.join(' + ')} = ${roll.total}`);
}
