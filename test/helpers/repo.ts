import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  readonly root: string;
  write(path: string, content: string): void;
  cleanup(): void;
}

export function makeRepo(files: Record<string, string> = {}): TestRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wf-test-')));
  const write = (path: string, content: string): void => {
    const abs = join(root, ...path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  Object.entries(files).forEach(([p, c]) => write(p, c));
  return { root, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function git(root: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=wf-test', '-c', 'user.email=wf-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
