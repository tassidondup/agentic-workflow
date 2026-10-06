import { afterEach, describe, expect, it } from 'vitest';
import { approve } from '../src/approve.js';
import { checkGate } from '../src/gate-check.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const files = {
  [`${C}/proposal.md`]: 'p',
  [`${C}/spec-delta.md`]: 's',
  [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
  [`${C}/design/design.md`]: 'd',
};

describe('approve', () => {
  it('approves the spec gate and writes the record', () => {
    repo = makeRepo(files);
    const { path } = approve(repo.root, 'c1', 'spec');
    expect(path).toMatch(/approvals\/spec\.json$/);
    expect(checkGate(repo.root, 'c1', 'spec').status).toBe('valid');
  });

  it('refuses to approve design while spec is missing', () => {
    repo = makeRepo(files);
    expect(() => approve(repo.root, 'c1', 'design')).toThrow(/Cannot approve design: the spec gate is missing/);
  });

  it('refuses to approve design while spec has changed since approval', () => {
    repo = makeRepo(files);
    approve(repo.root, 'c1', 'spec');
    repo.write(`${C}/proposal.md`, 'p2');
    expect(() => approve(repo.root, 'c1', 'design')).toThrow(/the spec gate is changed/);
  });

  it('re-approving a stale downstream gate makes it valid', () => {
    repo = makeRepo(files);
    approve(repo.root, 'c1', 'spec');
    approve(repo.root, 'c1', 'design');
    repo.write(`${C}/spec-delta.md`, 's2');
    approve(repo.root, 'c1', 'spec');
    expect(checkGate(repo.root, 'c1', 'design').status).toBe('stale');
    approve(repo.root, 'c1', 'design');
    expect(checkGate(repo.root, 'c1', 'design').status).toBe('valid');
  });
});
