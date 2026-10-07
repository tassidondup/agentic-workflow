import { afterEach, describe, expect, it } from 'vitest';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, parseConfig } from '../src/config.js';
import { readChange, readRetires } from '../src/change.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const good = {
  approvers: ['tassi'],
  test: { command: ['npx', 'vitest', 'run'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: ['vitest.config.ts'] },
};

describe('parseConfig', () => {
  it('accepts a valid config and defaults setup to null', () => {
    const c = parseConfig(good);
    expect(c.approvers).toEqual(['tassi']);
    expect(c.test.setup).toBeNull();
    expect(Object.isFrozen(c)).toBe(true);
  });
  it('reads acceptanceDir and harness, and allows an empty harness', () => {
    const c = parseConfig(good);
    expect(c.test.acceptanceDir).toBe('tests/acceptance');
    expect(c.test.harness).toEqual(['vitest.config.ts']);
    expect(Object.isFrozen(c.test.harness)).toBe(true);
    expect(parseConfig({ ...good, test: { ...good.test, harness: [] } }).test.harness).toEqual([]);
  });
  it.each([
    ['missing acceptanceDir', { acceptanceDir: undefined }, /"test\.acceptanceDir" must be a repo-relative path/],
    ['unsafe acceptanceDir', { acceptanceDir: '../tests' }, /"test\.acceptanceDir" is not a safe repo path/],
    ['acceptanceDir that holds staging', { acceptanceDir: 'docs' }, /may not overlap docs\/changes/],
    ['acceptanceDir inside staging', { acceptanceDir: 'docs/changes/c1/tests' }, /may not overlap docs\/changes/],
    ['report inside acceptanceDir', { junitReport: 'tests/acceptance/junit.xml' }, /"test\.junitReport" may not be inside "test\.acceptanceDir"/],
    ['missing harness', { harness: undefined }, /"test\.harness" must be a list/],
    ['unsafe harness path', { harness: ['ok.ts', '/etc/passwd'] }, /"test\.harness\[1\]" is not a safe repo path/],
    ['non-string harness path', { harness: [5] }, /"test\.harness\[0\]" must be a repo-relative path/],
  ])('rejects %s (Review Focus 2)', (_name, patch, message) => {
    expect(() => parseConfig({ ...good, test: { ...good.test, ...patch } })).toThrow(message);
  });
  it('accepts an optional setup command', () => {
    expect(parseConfig({ ...good, test: { ...good.test, setup: ['npm', 'ci'] } }).test.setup).toEqual(['npm', 'ci']);
  });
  it.each([
    ['not an object', []],
    ['empty approvers', { ...good, approvers: [] }],
    ['blank approver', { ...good, approvers: [' '] }],
    ['shell string command', { ...good, test: { ...good.test, command: 'npm test' } }],
    ['empty command', { ...good, test: { ...good.test, command: [] } }],
    ['unsafe report path', { ...good, test: { ...good.test, junitReport: '../x.xml' } }],
    ['missing test block', { approvers: ['tassi'] }],
  ])('rejects %s (Review Focus 2)', (_name, raw) => {
    expect(() => parseConfig(raw)).toThrow(/workflow\.config\.json/);
  });
});

describe('loadConfig', () => {
  it('names the file when JSON is truncated (Review Focus 2)', () => {
    repo = makeRepo({ 'workflow.config.json': '{"approvers": [' });
    expect(() => loadConfig(repo.root)).toThrow(/workflow\.config\.json/);
  });
  it('names the file when it is missing', () => {
    repo = makeRepo();
    expect(() => loadConfig(repo.root)).toThrow(/workflow\.config\.json/);
  });
  it('rejects a symlinked workflow.config.json', () => {
    repo = makeRepo();
    const tmpFile = join(repo.root, 'config-target.json');
    writeFileSync(tmpFile, '{"approvers":["user"],"test":{"command":["npm"],"junitReport":"reports/junit.xml","acceptanceDir":"tests/acceptance","harness":[]}}');
    symlinkSync(tmpFile, join(repo.root, 'workflow.config.json'));
    expect(() => loadConfig(repo.root)).toThrow(/Symlinks are not allowed: workflow\.config\.json/);
  });
});

describe('readChange and readRetires', () => {
  it('reads a valid change.json', () => {
    repo = makeRepo({ 'docs/changes/c1/change.json': '{"level":"P1","noBehaviourChange":false}' });
    expect(readChange(repo.root, 'c1')).toEqual({ level: 'P1', noBehaviourChange: false });
  });
  it.each([
    '{"level":"P9","noBehaviourChange":false}',
    '{"level":"P1"}',
    '{"level":"P1","noBehaviourChange":"no"}',
    'not json',
  ])('rejects a malformed change.json %j (Review Focus 2)', (body) => {
    repo = makeRepo({ 'docs/changes/c1/change.json': body });
    expect(() => readChange(repo.root, 'c1')).toThrow(/change\.json/);
  });
  it('returns an empty set when retires.json is absent', () => {
    repo = makeRepo();
    expect(readRetires(repo.root, 'c1').size).toBe(0);
  });
  it('reads retired row ids and rejects malformed ones', () => {
    repo = makeRepo({ 'docs/changes/c1/retires.json': '["LST-001","LST-002"]' });
    expect([...readRetires(repo.root, 'c1')]).toEqual(['LST-001', 'LST-002']);
    repo.write('docs/changes/c1/retires.json', '["lst-1"]');
    expect(() => readRetires(repo.root, 'c1')).toThrow(/retires\.json/);
  });
  it('rejects a symlinked change.json', () => {
    repo = makeRepo({ 'docs/changes/c1/.gitkeep': '' });
    const tmpFile = join(repo.root, 'change-target.json');
    writeFileSync(tmpFile, '{"level":"P0","noBehaviourChange":true}');
    symlinkSync(tmpFile, join(repo.root, 'docs/changes/c1/change.json'));
    expect(() => readChange(repo.root, 'c1')).toThrow(/Symlinks are not allowed: docs\/changes\/c1\/change\.json/);
  });
  it('rejects a symlinked retires.json (existing target)', () => {
    repo = makeRepo({ 'docs/changes/c1/.gitkeep': '' });
    const tmpFile = join(repo.root, 'retires-target.json');
    writeFileSync(tmpFile, '["LST-001"]');
    symlinkSync(tmpFile, join(repo.root, 'docs/changes/c1/retires.json'));
    expect(() => readRetires(repo.root, 'c1')).toThrow(/Symlinks are not allowed: docs\/changes\/c1\/retires\.json/);
  });
  it('rejects a symlinked retires.json (dangling symlink)', () => {
    repo = makeRepo({ 'docs/changes/c1/.gitkeep': '' });
    symlinkSync('/nonexistent/file.json', join(repo.root, 'docs/changes/c1/retires.json'));
    expect(() => readRetires(repo.root, 'c1')).toThrow(/Symlinks are not allowed: docs\/changes\/c1\/retires\.json/);
  });
});
