import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  DirectoryNotEmptyError,
  HasExtension,
  InMemoryFileSystem,
  InvalidPathError,
  IsADirectoryError,
  IsType,
  MaxSize,
  MinSize,
  MoveIntoSelfError,
  NameMatches,
  NodeAlreadyExistsError,
  NodeNotFoundError,
  NodeType,
  NotADirectoryError,
  RootOperationError,
} from './index';

let fs: InMemoryFileSystem;
let clock: FakeClock;

beforeEach(() => {
  clock = new FakeClock('2026-03-01T09:00:00Z');
  fs = new InMemoryFileSystem({ clock, ids: new SequentialIdGenerator() });
});

describe('paths and mkdir', () => {
  it('creates directories one level at a time or recursively', () => {
    fs.mkdir('/a');
    expect(() => fs.mkdir('/x/y')).toThrow(NodeNotFoundError);
    expect(() => fs.mkdir('/a')).toThrow(NodeAlreadyExistsError);
    fs.mkdir('/x/y/z', { recursive: true });
    fs.mkdir('/x/y', { recursive: true }); // mkdir -p accepts an existing directory
    expect(fs.ls('/')).toEqual(['a/', 'x/']);
    expect(fs.stat('/x/y/z').type).toBe(NodeType.DIRECTORY);
  });

  it('resolves ".", ".." and repeated slashes, and rejects relative paths and walking through a file', () => {
    fs.mkdir('/a/b', { recursive: true });
    fs.writeFile('/a/b/c.txt', 'hi');
    expect(fs.readFile('//a/./b/../b//c.txt')).toBe('hi');
    expect(fs.stat('/a/b/../..').path).toBe('/');
    expect(() => fs.ls('a/b')).toThrow(InvalidPathError);
    expect(() => fs.ls('/a/b/c.txt/d')).toThrow(NotADirectoryError);
    expect(() => fs.mkdir('/a/b/c.txt/d', { recursive: true })).toThrow(NotADirectoryError);
    expect(fs.exists('/a/b/c.txt/d')).toBe(false);
    expect(fs.exists('/a/b')).toBe(true);
  });
});

describe('files', () => {
  it('creates, reads, overwrites and appends, stamping modification time from the clock', () => {
    fs.createFile('/notes.txt', 'one');
    expect(() => fs.createFile('/notes.txt')).toThrow(NodeAlreadyExistsError);
    clock.advanceMinutes(10);
    fs.appendFile('/notes.txt', ' two');
    expect(fs.readFile('/notes.txt')).toBe('one two');
    fs.writeFile('/notes.txt', 'fresh');
    expect(fs.readFile('/notes.txt')).toBe('fresh');
    const stat = fs.stat('/notes.txt');
    expect(stat.createdAt.toISOString()).toBe('2026-03-01T09:00:00.000Z');
    expect(stat.modifiedAt.toISOString()).toBe('2026-03-01T09:10:00.000Z');
    expect(fs.appendFile('/new.log', 'x').path).toBe('/new.log');
  });

  it('refuses file operations on directories and on missing parents', () => {
    fs.mkdir('/docs');
    expect(() => fs.readFile('/docs')).toThrow(IsADirectoryError);
    expect(() => fs.writeFile('/docs', 'x')).toThrow(IsADirectoryError);
    expect(() => fs.readFile('/missing.txt')).toThrow(NodeNotFoundError);
    expect(() => fs.createFile('/nope/a.txt')).toThrow(NodeNotFoundError);
    expect(() => fs.ls('/ghost')).toThrow(NodeNotFoundError);
    expect(fs.ls('/docs')).toEqual([]);
  });
});

describe('stat sizes (composite)', () => {
  it('computes directory sizes recursively in UTF-8 bytes', () => {
    fs.mkdir('/p/q', { recursive: true });
    fs.writeFile('/p/a.txt', 'abc'); // 3 bytes
    fs.writeFile('/p/q/b.txt', 'é!'); // 2 + 1 bytes
    expect(fs.stat('/p/q/b.txt').size).toBe(3);
    expect(fs.stat('/p')).toMatchObject({ size: 6, childCount: 2, type: NodeType.DIRECTORY });
    expect(fs.stat('/').size).toBe(6);
  });
});

describe('mv', () => {
  beforeEach(() => {
    fs.mkdir('/src/lib', { recursive: true });
    fs.mkdir('/dist');
    fs.writeFile('/src/lib/util.ts', 'export {}');
    fs.writeFile('/src/main.ts', 'main');
  });

  it('renames, moves into an existing directory, and keeps derived paths correct', () => {
    fs.mv('/src/main.ts', '/src/index.ts');
    expect(fs.ls('/src')).toEqual(['index.ts', 'lib/']);
    const moved = fs.mv('/src/lib', '/dist');
    expect(moved.path).toBe('/dist/lib');
    expect(fs.readFile('/dist/lib/util.ts')).toBe('export {}');
    expect(fs.exists('/src/lib')).toBe(false);
  });

  it('refuses moving a directory into itself, overwriting, or moving the root', () => {
    expect(() => fs.mv('/src', '/src/lib/src')).toThrow(MoveIntoSelfError);
    expect(() => fs.mv('/src', '/src')).toThrow(MoveIntoSelfError);
    fs.writeFile('/dist/main.ts', 'old');
    expect(() => fs.mv('/src/main.ts', '/dist/main.ts')).toThrow(NodeAlreadyExistsError);
    expect(() => fs.mv('/src/main.ts', '/dist')).toThrow(NodeAlreadyExistsError);
    expect(() => fs.mv('/', '/dist')).toThrow(RootOperationError);
    expect(() => fs.mv('/nope', '/dist')).toThrow(NodeNotFoundError);
    expect(fs.readFile('/src/main.ts')).toBe('main');
  });
});

describe('rm', () => {
  it('removes files, refuses non-empty directories unless recursive, never the root', () => {
    fs.mkdir('/tmp/cache', { recursive: true });
    fs.writeFile('/tmp/cache/a.bin', 'xx');
    fs.rm('/tmp/cache/a.bin');
    expect(fs.ls('/tmp/cache')).toEqual([]);
    fs.writeFile('/tmp/cache/b.bin', 'yy');
    expect(() => fs.rm('/tmp')).toThrow(DirectoryNotEmptyError);
    fs.rm('/tmp', { recursive: true });
    expect(fs.exists('/tmp')).toBe(false);
    expect(() => fs.rm('/')).toThrow(RootOperationError);
    expect(() => fs.rm('/tmp')).toThrow(NodeNotFoundError);
  });
});

describe('find with composable specifications', () => {
  beforeEach(() => {
    fs.mkdir('/app/src/components', { recursive: true });
    fs.writeFile('/app/src/index.ts', '1234567890'); // 10 B
    fs.writeFile('/app/src/components/Button.tsx', '12345'); // 5 B
    fs.writeFile('/app/src/components/button.test.ts', '123456789012345678901'); // 21 B
    fs.writeFile('/app/README.md', '12'); // 2 B
  });

  it('filters by extension, glob and type', () => {
    expect(fs.find('/', new HasExtension('.ts'))).toEqual(['/app/src/components/button.test.ts', '/app/src/index.ts']);
    expect(fs.find('/app', new NameMatches('*utton*'))).toEqual([
      '/app/src/components/Button.tsx',
      '/app/src/components/button.test.ts',
    ]);
    expect(fs.find('/app', new IsType(NodeType.DIRECTORY))).toEqual(['/app/src', '/app/src/components']);
  });

  it('combines size bounds and other filters with and / or / not', () => {
    const smallFiles = new IsType(NodeType.FILE).and(new MinSize(3)).and(new MaxSize(10));
    expect(fs.find('/', smallFiles)).toEqual(['/app/src/components/Button.tsx', '/app/src/index.ts']);
    const tsOrMd = new HasExtension('ts').or(new HasExtension('md'));
    expect(fs.find('/app', tsOrMd.and(new NameMatches('*.test.*').not()))).toEqual(['/app/README.md', '/app/src/index.ts']);
    expect(fs.find('/app/src/index.ts', new MinSize(1))).toEqual(['/app/src/index.ts']);
  });
});
