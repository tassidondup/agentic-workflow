import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '../src/hash.js';

describe('hash', () => {
  it('computes the standard sha256 of a string', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
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
