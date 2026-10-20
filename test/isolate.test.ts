import { describe, expect, it } from 'vitest';
import type { Exec } from '../src/exec.js';
import { dockerArgs, runIsolated } from '../src/isolate.js';

const IDS = { uid: 1001, gid: 118 };

describe('dockerArgs', () => {
  it('builds a locked-down run with the checkout mounted at its own host path and no network', () => {
    expect(dockerArgs('node:24', '/home/runner/work/r/r/pr', 'none', ['npx', 'vitest', 'run'], IDS)).toEqual([
      'run', '--rm',
      '--user', '1001:118',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '1024',
      '--network', 'none',
      '-e', 'HOME=/tmp',
      '--mount', 'type=bind,source=/home/runner/work/r/r/pr,target=/home/runner/work/r/r/pr',
      '-w', '/home/runner/work/r/r/pr',
      'node:24',
      'npx', 'vitest', 'run',
    ]);
  });
  it('only the network differs for setup', () => {
    const none = dockerArgs('node:24', '/r', 'none', ['x'], IDS);
    const bridge = dockerArgs('node:24', '/r', 'bridge', ['x'], IDS);
    expect(bridge.map((a) => (a === 'bridge' ? 'none' : a))).toEqual(none);
  });
  it('leaves out --user where the platform has no uid', () => {
    expect(dockerArgs('node:24', '/r', 'none', ['x'], null)).not.toContain('--user');
  });
  it('passes the command after the image, so its words can never be docker options', () => {
    const args = dockerArgs('node:24', '/r', 'none', ['--privileged', '-v', '/:/host'], IDS);
    const at = args.indexOf('node:24');
    expect(args.slice(at + 1)).toEqual(['--privileged', '-v', '/:/host']);
    expect(args.filter((a) => a === '--privileged')).toHaveLength(1);
  });
  it.each(['/a,b', '/a\nb', '/a b,c=d'])('refuses a checkout path docker would misparse: %j', (root) => {
    expect(() => dockerArgs('node:24', root, 'none', ['x'], IDS)).toThrow(/checkout path/);
  });
  it.each(['', '-v', 'a b', '--privileged'])('refuses a bad image %j', (image) => {
    expect(() => dockerArgs(image, '/r', 'none', ['x'], IDS)).toThrow(/image/);
  });
});

describe('runIsolated', () => {
  it('runs docker in the checkout and returns the status and both streams', () => {
    const calls: Array<[string, readonly string[], string]> = [];
    const exec: Exec = (cmd, args, cwd) => {
      calls.push([cmd, args, cwd]);
      return { status: 3, stdout: 'out\n', stderr: 'err\n' };
    };
    const r = runIsolated(exec, 'node:24', '/r', ['npm', 'ci'], 'bridge');
    expect(r).toEqual({ status: 3, output: 'out\nerr\n' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('docker');
    expect(calls[0]?.[1].slice(-2)).toEqual(['npm', 'ci']);
    expect(calls[0]?.[1]).toContain('bridge');
    expect(calls[0]?.[2]).toBe('/r');
  });
  it('refuses an empty command', () => {
    expect(() => runIsolated(() => ({ status: 0, stdout: '', stderr: '' }), 'node:24', '/r', [], 'none')).toThrow(/empty/i);
  });
});
