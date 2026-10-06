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
  test: { command: ['npx', 'vitest', 'run'], junitReport: 'reports/junit.xml' },
};

describe('parseConfig', () => {
  it('accepts a valid config and defaults setup to null', () => {
    const c = parseConfig(good);
    expect(c.approvers).toEqual(['tassi']);
    expect(c.test.setup).toBeNull();
    expect(Object.isFrozen(c)).toBe(true);
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
    writeFileSync(tmpFile, '{"approvers":["user"],"test":{"command":["npm"],"junitReport":"reports/junit.xml"}}');
    symlinkSync(tmpFile, join(repo.root, 'workflow.config.json'));
    expect(() => loadConfig(repo.root)).toThrow(/workflow\.config\.json: symlinks are not allowed/);
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
    expect(() => readChange(repo.root, 'c1')).toThrow(/change\.json: symlinks are not allowed/);
  });
  it('rejects a symlinked retires.json (existing target)', () => {
    repo = makeRepo({ 'docs/changes/c1/.gitkeep': '' });
    const tmpFile = join(repo.root, 'retires-target.json');
    writeFileSync(tmpFile, '["LST-001"]');
    symlinkSync(tmpFile, join(repo.root, 'docs/changes/c1/retires.json'));
    expect(() => readRetires(repo.root, 'c1')).toThrow(/retires\.json: symlinks are not allowed/);
  });
  it('rejects a symlinked retires.json (dangling symlink)', () => {
    repo = makeRepo({ 'docs/changes/c1/.gitkeep': '' });
    symlinkSync('/nonexistent/file.json', join(repo.root, 'docs/changes/c1/retires.json'));
    expect(() => readRetires(repo.root, 'c1')).toThrow(/retires\.json: symlinks are not allowed/);
  });
});
