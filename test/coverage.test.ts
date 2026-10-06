import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coveredFiles } from '../src/coverage.js';
import { makeRepo, mkfifo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';

describe('coveredFiles', () => {
  it('covers the spec files', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's', [`${C}/change.json`]: '{}', [`${C}/tasks.md`]: 't' });
    expect(coveredFiles(repo.root, 'c1', 'spec')).toEqual([`${C}/change.json`, `${C}/proposal.md`, `${C}/spec-delta.md`]);
  });
  it('names missing spec files', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p' });
    expect(() => coveredFiles(repo.root, 'c1', 'spec')).toThrow(/missing: spec-delta\.md, change\.json/);
  });
  it('covers everything under design/, including staged files with spaces in names', () => {
    repo = makeRepo({
      [`${C}/design/design.md`]: 'd',
      [`${C}/design/mockups/list view.png`]: 'png',
      [`${C}/design/stage/packages/contracts/openapi.yaml`]: 'y',
    });
    expect(coveredFiles(repo.root, 'c1', 'design')).toEqual([
      `${C}/design/design.md`,
      `${C}/design/mockups/list view.png`,
      `${C}/design/stage/packages/contracts/openapi.yaml`,
    ]);
  });
  it('requires design.md', () => {
    repo = makeRepo({ [`${C}/design/stage/a.yaml`]: 'y' });
    expect(() => coveredFiles(repo.root, 'c1', 'design')).toThrow(/missing: design\/design\.md/);
  });
  it('covers staged tests, baseline.json and optional retires.json', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 't', [`${C}/baseline.json`]: '{}' });
    expect(coveredFiles(repo.root, 'c1', 'tests')).toEqual([
      `${C}/baseline.json`,
      `${C}/tests/stage/tests/acceptance/a.test.ts`,
    ]);
    repo.write(`${C}/retires.json`, '[]');
    expect(coveredFiles(repo.root, 'c1', 'tests')).toContain(`${C}/retires.json`);
  });

  it('refuses a symlinked spec-delta.md pointing outside the repo (R7)', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p', [`${C}/change.json`]: '{}' });
    const outside = mkdtempSync(join(tmpdir(), 'wf-outside-'));
    const target = join(outside, 'external.md');
    writeFileSync(target, 'external');
    symlinkSync(target, join(repo.root, C, 'spec-delta.md'));
    expect(() => coveredFiles(repo.root, 'c1', 'spec')).toThrow(/Symlinks are not allowed/);
  });

  it('refuses a dangling symlinked retires.json for the tests gate (R7)', () => {
    repo = makeRepo({ [`${C}/tests/a.test.ts`]: 't', [`${C}/baseline.json`]: '{}' });
    symlinkSync(join(repo.root, 'does-not-exist.json'), join(repo.root, C, 'retires.json'));
    expect(() => coveredFiles(repo.root, 'c1', 'tests')).toThrow(/Symlinks are not allowed/);
  });

  it('refuses a change folder that is itself a symlink (R7)', () => {
    repo = makeRepo({ 'real-change/proposal.md': 'p', 'real-change/spec-delta.md': 's', 'real-change/change.json': '{}' });
    mkdirSync(join(repo.root, 'docs', 'changes'), { recursive: true });
    symlinkSync(join(repo.root, 'real-change'), join(repo.root, 'docs', 'changes', 'c1'));
    expect(() => coveredFiles(repo.root, 'c1', 'spec')).toThrow(/Symlinks are not allowed/);
  });

  it('refuses a FIFO in a gated folder', () => {
    repo = makeRepo({ [`${C}/design/design.md`]: 'd' });
    mkfifo(join(repo.root, C, 'design', 'pipe'));
    expect(() => coveredFiles(repo.root, 'c1', 'design')).toThrow(`Not a regular file: ${C}/design/pipe`);
  });

  it('refuses a named file that is a FIFO', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's' });
    mkfifo(join(repo.root, C, 'change.json'));
    expect(() => coveredFiles(repo.root, 'c1', 'spec')).toThrow(`Not a regular file: ${C}/change.json`);
  });

  it('refuses when docs/changes itself is a symlink', () => {
    repo = makeRepo({ 'real/c1/proposal.md': 'p', 'real/c1/spec-delta.md': 's', 'real/c1/change.json': '{}' });
    mkdirSync(join(repo.root, 'docs'));
    symlinkSync(join(repo.root, 'real'), join(repo.root, 'docs', 'changes'));
    expect(() => coveredFiles(repo.root, 'c1', 'spec')).toThrow('Symlinks are not allowed: docs/changes');
  });
});
