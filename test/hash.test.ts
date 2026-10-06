import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256, sha256File } from '../src/hash.js';

describe('hash', () => {
  it('computes the standard sha256 of a string', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes file bytes, so a CRLF change produces a different hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-hash-'));
    const lf = join(dir, 'lf.md');
    const crlf = join(dir, 'crlf.md');
    writeFileSync(lf, 'a\nb\n');
    writeFileSync(crlf, 'a\r\nb\r\n');
    expect(sha256File(lf)).toBe(sha256('a\nb\n'));
    expect(sha256File(lf)).not.toBe(sha256File(crlf));
  });

  it('writes canonical JSON with sorted keys at every depth and a trailing newline', () => {
    const json = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } });
    expect(json).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it('gives the same canonical JSON regardless of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});
