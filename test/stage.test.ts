import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStage, promote, stageCheck, stagedFiles } from '../src/stage.js';
import { approveAll, changeFiles } from './helpers/change.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';

describe('staging', () => {
  it('maps staged files to the live paths they mirror', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/price.test.ts`]: 't' });
    expect(stagedFiles(repo.root, 'c1', 'tests')).toEqual([
      { stagePath: `${C}/tests/stage/tests/acceptance/price.test.ts`, livePath: 'tests/acceptance/price.test.ts' },
    ]);
  });

  it('promotes staged files into live paths and then reports no mismatch', () => {
    repo = makeRepo({ [`${C}/design/stage/packages/contracts/openapi.yaml`]: 'openapi: 3.1.0\n' });
    expect(checkStage(repo.root, 'c1', 'design')).toEqual([{ livePath: 'packages/contracts/openapi.yaml', reason: 'missing' }]);
    expect(promote(repo.root, 'c1', 'design')).toEqual(['packages/contracts/openapi.yaml']);
    expect(readFileSync(join(repo.root, 'packages/contracts/openapi.yaml'), 'utf8')).toBe('openapi: 3.1.0\n');
    expect(checkStage(repo.root, 'c1', 'design')).toEqual([]);
  });

  it('reports a live file that differs from the approved staging', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 'expect(422)' });
    promote(repo.root, 'c1', 'tests');
    repo.write('tests/acceptance/a.test.ts', 'expect(200)');
    expect(checkStage(repo.root, 'c1', 'tests')).toEqual([{ livePath: 'tests/acceptance/a.test.ts', reason: 'different' }]);
  });

  it.each([
    'docs/changes/other/x.md',
    '.git/config',
    '.github/workflows/ci.yml',
    '.workflow/version',
    '.GitHub/workflows/ci.yml',
    'DOCS/changes/x.md',
  ])('refuses staged files that target %s', (target) => {
    repo = makeRepo({ [`${C}/tests/stage/${target}`]: 'x' });
    expect(() => stagedFiles(repo.root, 'c1', 'tests')).toThrow(/may not target/);
  });

  it('refuses a symlink in staging and copies nothing (Review Focus 1)', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/a.test.ts`]: 't' });
    symlinkSync('/etc/hosts', join(repo.root, C, 'tests', 'stage', 'tests', 'hosts'));
    expect(() => promote(repo.root, 'c1', 'tests')).toThrow(/Symlinks are not allowed/);
    expect(() => readFileSync(join(repo.root, 'tests', 'a.test.ts'))).toThrow();
  });

  it('refuses to promote through a symlinked live folder and leaves the outside dir untouched (R3)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'wf-outside-'));
    repo = makeRepo({ [`${C}/tests/stage/tests/a.test.ts`]: 't' });
    symlinkSync(outside, join(repo.root, 'tests'));
    expect(() => promote(repo.root, 'c1', 'tests')).toThrow(/Symlinks are not allowed: tests/);
    expect(readdirSync(outside)).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  it('refuses to promote through a symlinked live file and leaves the outside file unchanged (R3)', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'wf-outside-'));
    const outsideFile = join(outsideDir, 'secret.test.ts');
    writeFileSync(outsideFile, 'original');
    repo = makeRepo({ [`${C}/tests/stage/tests/a.test.ts`]: 'malicious' });
    mkdirSync(join(repo.root, 'tests'), { recursive: true });
    symlinkSync(outsideFile, join(repo.root, 'tests', 'a.test.ts'));
    expect(() => promote(repo.root, 'c1', 'tests')).toThrow(/Symlinks are not allowed: tests/);
    expect(readFileSync(outsideFile, 'utf8')).toBe('original');
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('refuses checkStage when the live file is a symlink to the staged file itself (R3)', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/a.test.ts`]: 'same bytes' });
    mkdirSync(join(repo.root, 'tests'), { recursive: true });
    symlinkSync(join(repo.root, C, 'tests', 'stage', 'tests', 'a.test.ts'), join(repo.root, 'tests', 'a.test.ts'));
    expect(() => checkStage(repo.root, 'c1', 'tests')).toThrow(/Symlinks are not allowed: tests/);
  });

  it('stageCheck throws when the change or its spec-delta.md is missing (I3)', () => {
    repo = makeRepo();
    expect(() => stageCheck(repo.root, 'c1')).toThrow('Change c1 not found');
    repo.write(`${C}/proposal.md`, 'p');
    expect(() => stageCheck(repo.root, 'c1')).toThrow(/spec-delta\.md is missing/);
  });

  it('stageCheck requires a valid gate for every gate with staged files (I3)', () => {
    repo = makeRepo(changeFiles());
    promote(repo.root, 'c1', 'tests');
    expect(stageCheck(repo.root, 'c1')).toEqual(['tests gate is missing']);
    approveAll(repo);
    expect(stageCheck(repo.root, 'c1')).toEqual([]);
    repo.write(`${C}/tests/stage/tests/acceptance/a.test.ts`, 'loosened');
    expect(stageCheck(repo.root, 'c1')).toEqual(['tests gate is changed', 'tests: tests/acceptance/a.test.ts is different from approved staging']);
  });
});
