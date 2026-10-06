import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { sha256 } from '../src/hash.js';
import { buildRecord, writeRecord } from '../src/record.js';
import { checkAll, checkGate } from '../src/gate-check.js';
import type { Gate } from '../src/types.js';
import { makeRepo, mkfifo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const files = {
  [`${C}/proposal.md`]: 'p',
  [`${C}/spec-delta.md`]: 's',
  [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
  [`${C}/design/design.md`]: 'd',
  [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 't',
  [`${C}/baseline.json`]: '{}',
};
const approveRaw = (g: Gate): void => {
  writeRecord(repo.root, buildRecord(repo.root, 'c1', g));
};
const statuses = (): string[] => checkAll(repo.root, 'c1').map((r) => `${r.gate}:${r.status}`);

describe('checkGate', () => {
  it('reports missing records', () => {
    repo = makeRepo(files);
    expect(statuses()).toEqual(['spec:missing', 'design:missing', 'tests:missing']);
  });

  it('reports all valid after approving in order', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design'); approveRaw('tests');
    expect(statuses()).toEqual(['spec:valid', 'design:valid', 'tests:valid']);
  });

  it('marks an edited spec changed and downstream gates blocked', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design'); approveRaw('tests');
    repo.write(`${C}/spec-delta.md`, 's2');
    expect(statuses()).toEqual(['spec:changed', 'design:blocked', 'tests:blocked']);
    expect(checkGate(repo.root, 'c1', 'spec').problems).toContain(`${C}/spec-delta.md changed`);
  });

  it('marks downstream gates stale after the spec is re-approved (chained binding)', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design'); approveRaw('tests');
    repo.write(`${C}/spec-delta.md`, 's2');
    approveRaw('spec');
    expect(statuses()).toEqual(['spec:valid', 'design:stale', 'tests:blocked']);
    approveRaw('design');
    expect(statuses()).toEqual(['spec:valid', 'design:valid', 'tests:stale']);
    approveRaw('tests');
    expect(statuses()).toEqual(['spec:valid', 'design:valid', 'tests:valid']);
  });

  it('marks a gate changed when a file is added to its folder after approval (Review Focus 5)', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design');
    repo.write(`${C}/design/mockups/new.png`, 'x');
    const r = checkGate(repo.root, 'c1', 'design');
    expect(r.status).toBe('changed');
    expect(r.problems).toContain(`${C}/design/mockups/new.png was added after approval`);
  });

  it('marks a gate changed when a covered file is deleted', () => {
    repo = makeRepo({ ...files, [`${C}/design/extra.md`]: 'e' });
    approveRaw('spec'); approveRaw('design');
    rmSync(`${repo.root}/${C}/design/extra.md`);
    expect(checkGate(repo.root, 'c1', 'design').problems).toContain(`${C}/design/extra.md was deleted`);
  });

  it('treats an unreadable record as missing, never valid (Review Focus 2)', () => {
    repo = makeRepo({ ...files, [`${C}/approvals/spec.json`]: '{oops' });
    const r = checkGate(repo.root, 'c1', 'spec');
    expect(r.status).toBe('missing');
    expect(r.problems[0]).toMatch(/approvals\/spec\.json/);
  });

  it('reports record paths outside the gate without reading them (I2)', () => {
    repo = makeRepo({ ...files, 'README.md': 'r' });
    repo.symlink('/dev', 'link');
    const real = buildRecord(repo.root, 'c1', 'spec');
    const extra = [{ path: 'README.md', sha256: sha256('r') }, { path: 'link/zero', sha256: sha256('') }];
    writeRecord(repo.root, { ...real, covered: [...real.covered, ...extra] });
    const r = checkGate(repo.root, 'c1', 'spec');
    expect(r.status).toBe('changed');
    expect(r.problems).toEqual(['README.md is not covered by the spec gate', 'link/zero is not covered by the spec gate']);
  });

  it('reports a FIFO in a gated folder as a problem, never valid', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design');
    mkfifo(`${repo.root}/${C}/design/pipe`);
    const r = checkGate(repo.root, 'c1', 'design');
    expect(r.status).toBe('changed');
    expect(r.problems).toEqual([`Not a regular file: ${C}/design/pipe`]);
  });
});
