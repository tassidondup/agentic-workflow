import { readFileSync } from 'node:fs';

// Single source of truth: package.json, one level above both src/ and dist/.
function readVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = (pkg as { version?: unknown }).version;
  if (typeof version !== 'string') throw new Error('package.json has no "version"');
  return version;
}

export const TOOL_VERSION = readVersion();
