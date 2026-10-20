import type { Exec } from './exec.js';

export type Network = 'none' | 'bridge';

export interface Ids {
  readonly uid: number;
  readonly gid: number;
}

export interface IsolatedRun {
  readonly status: number;
  readonly output: string;
}

/**
 * The `docker run` argv for one isolated step (ADR 0002 layer 2). The checkout is mounted read-write at its own host
 * path, so absolute file paths in the runner's JUnit report still match the checkout `wf` reads them against. The
 * step runs as the host user, with no capabilities. `argv` goes after the image, so none of its words can be
 * read as a docker option. `ids` null (no uid on this platform) leaves `--user` out.
 */
export function dockerArgs(image: string, root: string, network: Network, argv: readonly string[], ids: Ids | null): string[] {
  if (image === '' || /\s/.test(image) || image.startsWith('-')) throw new Error(`Not a usable container image: ${JSON.stringify(image)}`);
  if (/[,\n\r]/.test(root)) throw new Error(`The checkout path cannot be mounted into a container (it holds a comma or a newline): ${JSON.stringify(root)}`);
  return [
    'run', '--rm',
    ...(ids === null ? [] : ['--user', `${ids.uid}:${ids.gid}`]),
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '1024',
    '--network', network,
    '-e', 'HOME=/tmp',
    '--mount', `type=bind,source=${root},target=${root}`,
    '-w', root,
    image,
    ...argv,
  ];
}

const hostIds = (): Ids | null => {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? null : { uid, gid };
};

/**
 * Runs `argv` in a fresh container. The container's processes cannot outlive it (they share its PID namespace,
 * ADR 0002), so nothing the step started can touch the checkout after this returns.
 */
export function runIsolated(exec: Exec, image: string, root: string, argv: readonly string[], network: Network): IsolatedRun {
  if (argv.length === 0) throw new Error('Empty command');
  const r = exec('docker', dockerArgs(image, root, network, argv, hostIds()), root);
  return { status: r.status, output: r.stdout + r.stderr };
}
