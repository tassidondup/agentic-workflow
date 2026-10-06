import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256, sha256File } from '../src/hash.js';
import { buildRecord, readRecord, recordFileSha, recordPath, writeRecord } from '../src/record.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const specFiles = { [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's', [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}' };

describe('approval records', () => {
  it('builds a spec record with hashes of covered files and no requirements', () => {
    repo = makeRepo(specFiles);
    const r = buildRecord(repo.root, 'c1', 'spec');
    expect(r.requires).toEqual([]);
    expect(r.covered).toEqual([
      { path: `${C}/change.json`, sha256: sha256(specFiles[`${C}/change.json`]) },
      { path: `${C}/proposal.md`, sha256: sha256('p') },
      { path: `${C}/spec-delta.md`, sha256: sha256('s') },
    ]);
  });

  it('writes canonical JSON, reads it back, and binds downstream records to the upstream file hash', () => {
    repo = makeRepo({ ...specFiles, [`${C}/design/design.md`]: 'd' });
    const path = writeRecord(repo.root, buildRecord(repo.root, 'c1', 'spec'));
    expect(path).toBe(recordPath(repo.root, 'c1', 'spec'));
    expect(readRecord(repo.root, 'c1', 'spec')?.gate).toBe('spec');
    expect(recordFileSha(repo.root, 'c1', 'spec')).toBe(sha256(readFileSync(path)));
    const design = buildRecord(repo.root, 'c1', 'design');
    expect(design.requires).toEqual([{ gate: 'spec', record_sha256: sha256File(path) }]);
  });

  it('refuses to build a downstream record before its upstream record exists', () => {
    repo = makeRepo({ ...specFiles, [`${C}/design/design.md`]: 'd' });
    expect(() => buildRecord(repo.root, 'c1', 'design')).toThrow(/spec has no approval record/);
  });

  it('returns null for a missing record', () => {
    repo = makeRepo();
    expect(readRecord(repo.root, 'c1', 'spec')).toBeNull();
    expect(recordFileSha(repo.root, 'c1', 'spec')).toBeNull();
  });

  it.each([
    ['truncated JSON', '{"change":'],
    ['wrong gate', '{"change":"c1","gate":"design","tool_version":"0.1.0","requires":[{"gate":"spec","record_sha256":"' + 'a'.repeat(64) + '"}],"covered":[]}'],
    ['wrong change', '{"change":"c2","gate":"spec","tool_version":"0.1.0","requires":[],"covered":[]}'],
    ['bad hash', '{"change":"c1","gate":"spec","tool_version":"0.1.0","requires":[],"covered":[{"path":"docs/a.md","sha256":"xyz"}]}'],
    ['unsafe covered path', '{"change":"c1","gate":"spec","tool_version":"0.1.0","requires":[],"covered":[{"path":"../a.md","sha256":"' + 'a'.repeat(64) + '"}]}'],
    ['missing requirement', '{"change":"c1","gate":"spec","tool_version":"0.1.0","requires":[{"gate":"spec","record_sha256":"' + 'a'.repeat(64) + '"}],"covered":[]}'],
  ])('rejects a malformed record: %s (Review Focus 2)', (_name, body) => {
    repo = makeRepo({ [`${C}/approvals/spec.json`]: body });
    expect(() => readRecord(repo.root, 'c1', 'spec')).toThrow(/approvals\/spec\.json/);
  });
});
