import { afterEach, describe, expect, it } from 'vitest';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config.js';
import { sha256 } from '../src/hash.js';
import { assertManifestCurrent, buildManifest, manifestProblems, parseManifest } from '../src/manifest.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const config = (harness: string[] = []) =>
  parseConfig({ approvers: ['tassi'], test: { command: ['node'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness } });

describe('buildManifest', () => {
  it('hashes each acceptance file with its row tags, and each harness path (null if absent)', () => {
    const a = "it('[LST-002] b'); it('[LST-001] a'); it('[LST-001] again');";
    repo = makeRepo({
      'tests/acceptance/a.test.ts': a,
      'tests/acceptance/helpers/fixture.ts': 'no tags',
      'vitest.config.ts': 'cfg',
      'src/decoy.test.ts': "it('[LST-001] decoy')",
    });
    expect(buildManifest(repo.root, config(['vitest.config.ts', 'absent.ts']))).toEqual({
      acceptance: [
        { path: 'tests/acceptance/a.test.ts', sha256: sha256(a), rows: ['LST-001', 'LST-002'] },
        { path: 'tests/acceptance/helpers/fixture.ts', sha256: sha256('no tags'), rows: [] },
      ],
      harness: [{ path: 'vitest.config.ts', sha256: sha256('cfg') }, { path: 'absent.ts', sha256: null }],
    });
  });
  it('is empty when the acceptance folder does not exist yet', () => {
    repo = makeRepo();
    expect(buildManifest(repo.root, config())).toEqual({ acceptance: [], harness: [] });
  });
  it('refuses a symlink inside the acceptance folder (Review Focus 4)', () => {
    repo = makeRepo({ 'tests/acceptance/a.test.ts': 't' });
    symlinkSync('/etc/hosts', join(repo.root, 'tests', 'acceptance', 'hosts'));
    expect(() => buildManifest(repo.root, config())).toThrow(/Symlinks are not allowed/);
  });
});

describe('parseManifest', () => {
  const entry = { path: 'tests/acceptance/a.test.ts', sha256: 'a'.repeat(64), rows: ['LST-001'] };
  it('accepts well-formed entries', () => {
    const m = { acceptance: [entry], harness: [{ path: 'vitest.config.ts', sha256: null }] };
    expect(parseManifest(m)).toEqual(m);
  });
  it.each([
    ['missing acceptance', { harness: [] }],
    ['missing harness', { acceptance: [] }],
    ['unsafe path', { acceptance: [{ ...entry, path: '../x' }], harness: [] }],
    ['bad hash', { acceptance: [{ ...entry, sha256: 'xyz' }], harness: [] }],
    ['bad row id', { acceptance: [{ ...entry, rows: ['lst-1'] }], harness: [] }],
    ['harness hash neither hex nor null', { acceptance: [], harness: [{ path: 'a', sha256: 5 }] }],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseManifest(raw)).toThrow(/"(acceptance|harness)" must list/);
  });
});

describe('assertManifestCurrent (Review Focus 3)', () => {
  it('passes for a fresh manifest; fails once an entry is removed by hand or a file changes', () => {
    repo = makeRepo({ 'tests/acceptance/a.test.ts': 't', 'tests/acceptance/decoy.test.ts': 'd' });
    const fresh = buildManifest(repo.root, config());
    expect(() => assertManifestCurrent(repo.root, config(), fresh)).not.toThrow();
    const hidden = { ...fresh, acceptance: fresh.acceptance.filter((e) => !e.path.endsWith('decoy.test.ts')) };
    expect(() => assertManifestCurrent(repo.root, config(), hidden))
      .toThrow(/baseline\.json is stale or invalid: files under tests\/acceptance or test\.harness changed since the baseline ran; re-run wf baseline/);
    repo.write('tests/acceptance/a.test.ts', 'changed');
    expect(() => assertManifestCurrent(repo.root, config(), fresh)).toThrow(/stale or invalid/);
  });
});

describe('manifestProblems (ADR 0001)', () => {
  const cfg = config(['vitest.config.ts', 'absent.ts']);
  const scope = (staged: string[] = [], retired: string[] = []) => ({ staged: new Set(staged), retired: new Set(retired) });
  const atGate = () => {
    repo = makeRepo({ 'tests/acceptance/old.test.ts': '// [LST-001] [LST-009]', 'vitest.config.ts': 'cfg' });
    return buildManifest(repo.root, cfg);
  };

  it('passes when the live folder is the manifest plus staged files', () => {
    const m = atGate();
    repo.write('tests/acceptance/new.test.ts', 'staged');
    expect(manifestProblems(repo.root, cfg, m, scope(['tests/acceptance/new.test.ts']))).toEqual([]);
  });

  it('flags a file nobody approved (a decoy inside the folder)', () => {
    const m = atGate();
    repo.write('tests/acceptance/decoy.test.ts', '// [LST-001]');
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual([
      'tests/acceptance/decoy.test.ts is not approved: it was not in tests/acceptance at the tests gate and this change does not stage it',
    ]);
  });

  it('flags an edited older acceptance test unless this change staged it', () => {
    const m = atGate();
    repo.write('tests/acceptance/old.test.ts', '// loosened');
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual(['tests/acceptance/old.test.ts changed since the tests gate']);
    expect(manifestProblems(repo.root, cfg, m, scope(['tests/acceptance/old.test.ts']))).toEqual([]);
  });

  it('allows deleting an acceptance file only when all its rows are retired', () => {
    const m = atGate();
    rmSync(join(repo.root, 'tests', 'acceptance', 'old.test.ts'));
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual([
      'tests/acceptance/old.test.ts was deleted, but its rows LST-001, LST-009 are not retired',
    ]);
    expect(manifestProblems(repo.root, cfg, m, scope([], ['LST-001']))).toEqual([
      'tests/acceptance/old.test.ts was deleted, but its rows LST-009 are not retired',
    ]);
    expect(manifestProblems(repo.root, cfg, m, scope([], ['LST-001', 'LST-009']))).toEqual([]);
  });

  it('flags a harness file that changed, appeared or vanished, unless staged', () => {
    const m = atGate();
    repo.write('vitest.config.ts', "exclude: ['tests/acceptance/**']");
    repo.write('absent.ts', 'new');
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual([
      'vitest.config.ts (test harness) changed since the tests gate',
      'absent.ts (test harness) changed since the tests gate',
    ]);
    expect(manifestProblems(repo.root, cfg, m, scope(['vitest.config.ts', 'absent.ts']))).toEqual([]);
    rmSync(join(repo.root, 'vitest.config.ts'));
    expect(manifestProblems(repo.root, cfg, m, scope([], []))[0]).toBe('vitest.config.ts (test harness) changed since the tests gate');
  });
});
