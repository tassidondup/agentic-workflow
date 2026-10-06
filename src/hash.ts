import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export const sha256File = (absPath: string): string => sha256(readFileSync(absPath));

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeys(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
