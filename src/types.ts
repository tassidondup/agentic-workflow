export type Gate = 'spec' | 'design' | 'tests';
export const GATES: readonly Gate[] = ['spec', 'design', 'tests'];
export const PREREQS: Readonly<Record<Gate, readonly Gate[]>> = {
  spec: [],
  design: ['spec'],
  tests: ['spec', 'design'],
};

export type StageGate = 'design' | 'tests';
export const STAGE_GATES: readonly StageGate[] = ['design', 'tests'];

export interface CoveredFile {
  readonly path: string;
  readonly sha256: string;
}

export interface Requirement {
  readonly gate: Gate;
  readonly record_sha256: string;
}

export interface ApprovalRecord {
  readonly change: string;
  readonly gate: Gate;
  readonly tool_version: string;
  readonly requires: readonly Requirement[];
  readonly covered: readonly CoveredFile[];
}

export type GateStatus = 'valid' | 'missing' | 'changed' | 'stale' | 'blocked';

export interface GateResult {
  readonly gate: Gate;
  readonly status: GateStatus;
  readonly problems: readonly string[];
}

export interface Issue {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}
