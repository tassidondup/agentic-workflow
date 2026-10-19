import type { TestConfig } from './config.js';
import type { ChangedFile } from './git.js';
import { isUnderPath } from './paths.js';

/**
 * Paths no `exempt` entry can cover. A PR touching any of them needs a gate or a change branch.
 * Every path in templates/CODEOWNERS is under one of these (test/exempt.test.ts checks), plus the files
 * that decide what runs in CI or in an agent's context.
 */
export const NEVER_EXEMPT: readonly string[] = Object.freeze([
  '.github',
  '.workflow',
  'workflow.config.json',
  'AGENTS.md',
  'CLAUDE.md',
  'roles',
  'docs/specs',
  'docs/decisions',
  'docs/changes',
  'tests/acceptance',
  'tests/harness',
]);

/** Matched by file name at any depth: they hold test scripts and install hooks. */
export const NEVER_EXEMPT_NAMES: readonly string[] = Object.freeze(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

/** Runner configs, matched by file-name prefix at any depth: the runner picks whichever variant exists (`vitest.config.mts` beats `.ts`). */
export const NEVER_EXEMPT_NAME_PREFIXES: readonly string[] = Object.freeze(['vitest.config.', 'vite.config.', 'jest.config.']);

const SYMLINK = '120000';
const SUBMODULE = '160000';

export interface ExemptPolicy {
  readonly exempt: readonly string[];
  readonly floor: readonly string[];
}

/** The fixed floor plus the acceptance folder and runner config this repo's own config names. */
export const floorFor = (test: Pick<TestConfig, 'acceptanceDir' | 'harness'>): readonly string[] =>
  Object.freeze([...NEVER_EXEMPT, test.acceptanceDir, ...test.harness]);

export const exemptPolicy = (config: { readonly exempt: readonly string[]; readonly test: Pick<TestConfig, 'acceptanceDir' | 'harness'> }): ExemptPolicy =>
  Object.freeze({ exempt: config.exempt, floor: floorFor(config.test) });

const lower = (p: string): string => p.toLowerCase();

/** Case-insensitive on purpose: a case-insensitive checkout maps `.GitHub/` onto `.github/`. */
export const isNeverExempt = (path: string, floor: readonly string[]): boolean => {
  const p = lower(path);
  const name = p.slice(p.lastIndexOf('/') + 1);
  return (
    NEVER_EXEMPT_NAMES.includes(name) ||
    NEVER_EXEMPT_NAME_PREFIXES.some((x) => name.startsWith(x)) ||
    floor.some((f) => isUnderPath(lower(f), p))
  );
};

/** A path is exempt only if an `exempt` entry covers it, the floor does not, and it is a plain file (no symlink or submodule). */
export function isExempt(file: ChangedFile, policy: ExemptPolicy): boolean {
  if (file.mode === SYMLINK || file.mode === SUBMODULE) return false;
  if (isNeverExempt(file.path, policy.floor)) return false;
  return policy.exempt.some((e) => isUnderPath(e, file.path));
}

export const nonExempt = (files: readonly ChangedFile[], policy: ExemptPolicy): readonly ChangedFile[] =>
  files.filter((f) => !isExempt(f, policy));
