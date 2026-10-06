import { spawnSync } from 'node:child_process';

export interface ExecResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Exec = (cmd: string, args: readonly string[], cwd: string) => ExecResult;

export const realExec: Exec = (cmd, args, cwd) => {
  const r = spawnSync(cmd, [...args], { cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`Could not run ${cmd}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
