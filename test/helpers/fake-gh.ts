import type { Exec } from '../../src/exec.js';

export interface GhRoute {
  readonly path: string;
  readonly body: unknown;
}

/** Every `gh` api path requested through a fake, in order. */
export const ghCalls: string[] = [];

export function resetGhCalls(): void {
  ghCalls.length = 0;
}

/** Answers `gh api <path>` from `routes`; an unknown path fails with HTTP 404. Other commands go to `real`. */
export function withFakeGh(routes: readonly GhRoute[], real: Exec): Exec {
  return (cmd, args, cwd) => {
    if (cmd !== 'gh') return real(cmd, args, cwd);
    const path = args[args.length - 1] ?? '';
    ghCalls.push(path);
    const route = routes.find((r) => r.path === path);
    if (!route) return { status: 1, stdout: '', stderr: 'HTTP 404' };
    return { status: 0, stdout: JSON.stringify(route.body), stderr: '' };
  };
}
