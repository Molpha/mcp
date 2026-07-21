/**
 * The single Solana settle path, shared by `molpha_execute` and
 * `molpha_fetch_verified`'s `autoSubmit` leg — one guardrail check, one shape
 * normalization, one place that knows what `submit_data_update` requires.
 */

import { toSignedResult } from "./artifacts.js";
import { getMolphaContext, requireMethod } from "./clients.js";
import { enforceExecuteCap, previewWrite } from "./guardrails.js";

export interface SubmitOutcome {
  chain: "solana";
  action: "submit_data_update";
  feedId: string;
  signature: string;
}

/**
 * Accepts the `molpha_fetch_verified` artifact or the flat signed result, and
 * returns the flat shape `submitDataUpdate` expects.
 */
export function prepareSignedResult(input: Record<string, unknown>): Record<string, unknown> {
  const result = toSignedResult(input);

  if (!result.feedId) {
    throw new Error("signed result is missing `feedId`");
  }

  // `buildSubmitArgs` packs `valuePacked` as the on-chain value; `value` is the
  // decimal rendering and is not interchangeable with it.
  if (!result.valuePacked) {
    throw new Error(
      "signed result is missing `valuePacked` (the on-chain encoding of `value`); re-run molpha_fetch_verified and pass its output through unmodified"
    );
  }

  return result;
}

export function previewSubmit(
  action: string,
  result: Record<string, unknown>,
  submitter: string
): ReturnType<typeof previewWrite> {
  return previewWrite(action, {
    chain: "solana",
    action: "submit_data_update",
    feedId: result.feedId,
    registryVersion: result.registryVersion,
    submitter
  });
}

/** Enforces the daily execute cap, then submits. Callers must pass a prepared result. */
export async function submitSignedResult(result: Record<string, unknown>): Promise<SubmitOutcome> {
  const { config, solana } = await getMolphaContext();
  enforceExecuteCap(config.guardrails);

  const submitDataUpdate = requireMethod<
    [Record<string, unknown>],
    Promise<{ signature: string }>
  >(solana, "submitDataUpdate");

  const tx = await submitDataUpdate(result);

  return {
    chain: "solana",
    action: "submit_data_update",
    feedId: String(result.feedId),
    signature: tx.signature
  };
}
