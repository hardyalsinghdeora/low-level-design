import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { HasExtension, InMemoryFileSystem, IsType, MinSize, NameMatches, NodeType } from './index';

const clock = new FakeClock('2026-03-01T09:00:00Z');
const fs = new InMemoryFileSystem({ clock, ids: new SequentialIdGenerator() });

console.log('\n--- Scaffolding a project with mkdir -p and writeFile ---');
fs.mkdir('/projects/app/src', { recursive: true });
fs.mkdir('/projects/app/docs', { recursive: true });
fs.writeFile('/projects/app/src/index.ts', "export * from './server';\n");
fs.writeFile('/projects/app/src/server.ts', 'export function start(port: number) {\n  return port;\n}\n');
fs.writeFile('/projects/app/docs/README.md', '# App\n');
fs.createFile('/projects/app/.gitignore', 'node_modules\n');
console.log(fs.tree('/projects'));

console.log('\n--- Appending to a log and reading it back ---');
clock.advanceMinutes(5);
fs.appendFile('/projects/app/build.log', 'build 1 ok\n');
fs.appendFile('/projects/app/build.log', 'build 2 ok\n');
console.log(`  ${JSON.stringify(fs.readFile('/projects/app/build.log'))}`);
const stats = fs.stat('/projects/app');
console.log(`  stat ${stats.path}: ${stats.type}, ${stats.size} B in ${stats.childCount} entries, modified ${stats.modifiedAt.toISOString()}`);

console.log('\n--- find: TypeScript files of at least 30 bytes ---');
console.log(`  ${fs.find('/', new HasExtension('ts').and(new MinSize(30))).join(', ')}`);
console.log('--- find: markdown or dotfiles, files only ---');
const docsOrDotfiles = new HasExtension('md').or(new NameMatches('.*')).and(new IsType(NodeType.FILE));
console.log(`  ${fs.find('/projects', docsOrDotfiles).join(', ')}`);
console.log('--- find: everything that is not a file ---');
console.log(`  ${fs.find('/', new IsType(NodeType.FILE).not()).join(', ')}`);

console.log('\n--- A directory cannot move into its own subtree ---');
try {
  fs.mv('/projects/app', '/projects/app/src/app');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
console.log('--- Moving docs/ into src/ and renaming README.md ---');
fs.mv('/projects/app/docs', '/projects/app/src');
fs.mv('/projects/app/src/docs/README.md', '/projects/app/src/docs/GUIDE.md');
console.log(`  ls src: ${fs.ls('/projects/app/src').join('  ')}`);

console.log('\n--- rm refuses a non-empty directory unless recursive ---');
try {
  fs.rm('/projects/app/src');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
fs.rm('/projects/app/src', { recursive: true });
console.log(fs.tree('/'));
