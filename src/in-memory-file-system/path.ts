import { InvalidPathError } from './errors';

/**
 * Turns an absolute path into its segments, resolving ".", ".." and repeated
 * slashes. Every public operation goes through here, so the tree itself only
 * ever sees clean names.
 */
export function parsePath(path: string): string[] {
  if (!path.startsWith('/')) throw new InvalidPathError(path, 'paths must be absolute (start with "/")');
  const segments: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments;
}

export function formatPath(segments: readonly string[]): string {
  return `/${segments.join('/')}`;
}

export function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

export function assertValidName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/')) {
    throw new InvalidPathError(name, 'a name cannot be empty, "." or "..", or contain "/"');
  }
}

/** "report.final.pdf" -> "pdf"; ".bashrc" and "Makefile" have none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
