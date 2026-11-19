/// <reference types="vite/client" />
import type { PuzzleKindModule } from './types';

/**
 * Every file in ./kinds/*.ts that default-exports a PuzzleKindModule is registered automatically,
 * so adding a kind never edits a shared file.
 */
const modules = import.meta.glob<{ default: PuzzleKindModule }>('./kinds/*.ts', { eager: true });

const registry = new Map<string, PuzzleKindModule>();
for (const mod of Object.values(modules)) {
  const kind = mod?.default;
  if (kind && typeof kind.kind === 'string' && typeof kind.mount === 'function') registry.set(kind.kind.toLowerCase(), kind);
}

export function findPuzzleKind(kind: string | null | undefined): PuzzleKindModule | null {
  return kind ? registry.get(kind.toLowerCase()) ?? null : null;
}

export function knownPuzzleKinds(): string[] {
  return [...registry.keys()].sort();
}
