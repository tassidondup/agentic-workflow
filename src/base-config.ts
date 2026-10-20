import { CONFIG_FILE, parseConfig, type WorkflowConfig } from './config.js';
import type { Exec } from './exec.js';
import { fileAt } from './git.js';

/**
 * Reads workflow.config.json from the BASE commit, never the PR head: a PR must not be able to choose the
 * settings that judge it. `use` names what the caller needs from it, for the problem message.
 */
export function baseConfig(root: string, base: string, exec: Exec, use: string): { config: WorkflowConfig } | { problem: string } {
  const text = fileAt(root, base, CONFIG_FILE, exec);
  if (text === null) return { problem: `${CONFIG_FILE} is not on ${base}; ${use} must come from the base branch` };
  try {
    return { config: parseConfig(JSON.parse(text) as unknown) };
  } catch (e) {
    return { problem: `${CONFIG_FILE} on ${base} is unusable for ${use}: ${(e as Error).message}` };
  }
}
