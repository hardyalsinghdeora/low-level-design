import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { InsertText, TextEditor } from './index';

const clock = new FakeClock('2026-03-01T10:00:00Z');
const editor = new TextEditor({ clock, ids: new SequentialIdGenerator() });

function show(caption: string): void {
  const { line, column } = editor.cursor;
  console.log(`  ${caption.padEnd(26)} ${JSON.stringify(editor.text)}  [Ln ${line}, Col ${column}]`);
}

console.log(`\n${editor.id}: an empty buffer`);

console.log('\n--- Typing ---');
editor.type('Hello world');
show('typed');
editor.select(6, 11);
editor.type('team');
show('typed over "world"');

console.log('\n--- A macro adds a heading as one undo step ---');
editor.macro('Add heading', [new InsertText(0, 'NOTES\n'), new InsertText(5, ' (draft)')]);
show('after macro');
const draft = editor.save('draft-1');
console.log(`  saved ${draft.id} "${draft.label}" at ${draft.savedAt.toISOString()}, dirty=${editor.isDirty}`);

console.log('\n--- Undo and redo ---');
editor.undo();
show('undo macro');
editor.redo();
show('redo macro');
editor.moveTo(2, 6);
editor.type(',');
show('typed a comma on line 2');
editor.undo();
show('undo comma');
console.log(`  canRedo=${editor.canRedo}; a new edit now clears it:`);
editor.type('!');
show('typed "!" instead');
console.log(`  canRedo=${editor.canRedo}`);

console.log('\n--- A bad range is rejected and nothing changes ---');
try {
  editor.deleteRange(10, 99);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
show('unchanged');

console.log('\n--- Oops: select all and delete, then restore the save point ---');
clock.advanceMinutes(5);
editor.selectAll();
editor.backspace();
show('after delete');
editor.restore(draft);
show('restored draft-1');
editor.undo();
show('restore is undoable too');
console.log(`\nUndo menu: ${editor.undoLabels.join(' | ')}`);
