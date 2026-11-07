import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { Game, PieceType } from './index';

const clock = new FakeClock('2026-03-01T18:00:00Z');
const game = new Game({ clock, ids: new SequentialIdGenerator() });

function play(from: string, to: string): void {
  clock.advanceSeconds(20);
  const record = game.move(from, to);
  console.log(`  ${record.ply}. ${record.color.padEnd(5)} ${record.notation.padEnd(9)} -> ${game.status}`);
}

console.log(`\n${game.id}: a new game, ${game.turn} to move`);
console.log(game.render());

console.log('\n--- Opening: white goes for the scholar\'s mate ---');
play('e2', 'e4');
play('e7', 'e5');
play('f1', 'c4');
play('b8', 'c6');
play('d1', 'h5');
console.log(`  Legal knight moves from g8: ${game.legalMoves('g8').join(', ')}`);

console.log('\n--- Black tries f7-f6, but the pawn is pinned against the king ---');
try {
  game.move('f7', 'f6');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- Black develops the knight instead and walks into mate ---');
play('g8', 'f6');
play('h5', 'f7');
console.log(game.render());
console.log(`  Status ${game.status}, winner ${game.winner}`);

console.log('\n--- Any further move is refused ---');
try {
  game.move('e8', 'e7');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}

console.log('\n--- Take back two plies; black defends with g7-g6 ---');
console.log(`  undone: ${game.undo().notation}, ${game.undo().notation}`);
play('g7', 'g6');
console.log(`  Status ${game.status}, ${game.turn} to move`);

console.log('\n--- Promotion from a composed position ---');
const endgame = Game.fromFen('8/P6k/8/8/8/8/8/K7 w', { clock, ids: new SequentialIdGenerator() });
const promo = endgame.move('a7', 'a8', PieceType.QUEEN);
console.log(`  ${promo.notation}: a8 now holds a ${endgame.pieceAt('a8')?.type}`);
console.log(`\nMoves in game 1: ${game.moves.map((m) => m.notation).join(' ')}`);
