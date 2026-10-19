import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exemptPolicy, floorFor, isExempt, isNeverExempt, nonExempt, NEVER_EXEMPT } from '../src/exempt.js';
import type { ChangedFile } from '../src/git.js';

const f = (path: string, status = 'M', mode = '100644'): ChangedFile => ({ status, path, mode });
const test = { acceptanceDir: 'tests/acceptance', harness: ['vitest.config.ts'] };
const policy = (exempt: string[]) => exemptPolicy({ exempt, test });

describe('isExempt', () => {
  it('exempts a file under an exempt folder and the file named exactly', () => {
    expect(isExempt(f('docs/guides/a.md'), policy(['docs/guides']))).toBe(true);
    expect(isExempt(f('README.md'), policy(['README.md']))).toBe(true);
  });
  it('matches whole segments, not string prefixes', () => {
    expect(isExempt(f('docs/guides-x/a.md'), policy(['docs/guides']))).toBe(false);
    expect(isExempt(f('README.md.bak'), policy(['README.md']))).toBe(false);
  });
  it('exempts nothing when the list is empty', () => {
    expect(isExempt(f('README.md'), policy([]))).toBe(false);
  });
  it('lets the floor win over an exempt folder that contains it', () => {
    const p = policy(['docs']);
    expect(isExempt(f('docs/guides/a.md'), p)).toBe(true);
    expect(isExempt(f('docs/specs/a.md'), p)).toBe(false);
    expect(isExempt(f('docs/changes/c1/proposal.md'), p)).toBe(false);
    expect(isExempt(f('docs/decisions/0002.md'), p)).toBe(false);
  });
  it('keeps the floor case-insensitive', () => {
    const p = policy(['docs']);
    expect(isExempt(f('Docs/Specs/a.md'), p)).toBe(false);
    expect(isNeverExempt('.GitHub/workflows/wf.yml', floorFor(test))).toBe(true);
  });
  it('keeps manifests and lockfiles out at any depth', () => {
    const p = policy(['packages', 'package.json']);
    for (const path of ['package.json', 'packages/a/package.json', 'packages/a/yarn.lock', 'pnpm-lock.yaml']) {
      expect(isExempt(f(path), p)).toBe(false);
    }
  });
  it('keeps every runner-config variant out, at any depth', () => {
    const p = policy(['apps', 'vitest.config.mts']);
    for (const path of ['vitest.config.mts', 'apps/web/vitest.config.js', 'apps/web/vite.config.ts', 'jest.config.cjs']) {
      expect(isExempt(f(path), p)).toBe(false);
    }
  });
  it('keeps this config\'s acceptance folder and harness out', () => {
    const p = policy(['tests', 'vitest.config.ts']);
    expect(isExempt(f('tests/acceptance/a.test.ts'), p)).toBe(false);
    expect(isExempt(f('vitest.config.ts'), p)).toBe(false);
    expect(isExempt(f('tests/unit/a.test.ts'), p)).toBe(true);
  });
  it('refuses a symlink or submodule even in an exempt folder, including its deletion', () => {
    const p = policy(['docs/guides']);
    expect(isExempt(f('docs/guides/link.md', 'A', '120000'), p)).toBe(false);
    expect(isExempt(f('docs/guides/link.md', 'D', '120000'), p)).toBe(false);
    expect(isExempt(f('docs/guides/vendor', 'A', '160000'), p)).toBe(false);
  });
  it('is case-sensitive for exempt entries: a different-case path is not exempt', () => {
    expect(isExempt(f('Docs/guides/a.md'), policy(['docs/guides']))).toBe(false);
  });
});

describe('nonExempt', () => {
  it('returns only the files that are not exempt', () => {
    const files = [f('docs/guides/a.md'), f('src/a.ts')];
    expect(nonExempt(files, policy(['docs/guides'])).map((x) => x.path)).toEqual(['src/a.ts']);
  });
  it('returns nothing for an empty diff', () => {
    expect(nonExempt([], policy([]))).toEqual([]);
  });
});

describe('floor drift', () => {
  it('covers every path templates/CODEOWNERS protects', () => {
    const lines = readFileSync(new URL('../templates/CODEOWNERS', import.meta.url), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(5);
    const floor = floorFor(test);
    for (const line of lines) {
      const pattern = line.split(/\s+/)[0] ?? '';
      // A concrete path the pattern matches: "/docs/changes/*/approvals/" -> docs/changes/x/approvals/x.
      const sample = pattern.replace(/^\//, '').replace(/\*/g, 'x').replace(/\/$/, '/x');
      expect(isNeverExempt(sample, floor), `${pattern} must be under the never-exempt floor`).toBe(true);
    }
  });
  it('lists no empty or absolute entries', () => {
    for (const p of NEVER_EXEMPT) expect(p).toMatch(/^[A-Za-z.][^\\]*$/);
  });
});
