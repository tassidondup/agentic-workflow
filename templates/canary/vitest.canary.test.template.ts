// Installed at the path named by `test.canary.template` in workflow.config.json (a test.harness file, so it is locked).
// CI runs `wf run-tests --canary <nonce>`, which copies this file to `test.canary.path` inside the acceptance folder
// with the placeholder replaced. The test fails on purpose: a report in which it passed, or is missing, was
// tampered with or filtered, and `wf trace-check --canary` rejects it (ADR 0002, layer 1).
import { expect, it } from 'vitest';

it('[canary:__WF_CANARY_NONCE__]', () => {
  expect('canary').toBe('must fail');
});
