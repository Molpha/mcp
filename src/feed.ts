/**
 * Feed-account presentation helpers.
 *
 * Anchor encodes the on-chain `FeedValueKind` enum as a single-key variant
 * object — `{ value: {} }` / `{ hash: {} }` — which reads like an empty stub in
 * tool output. Flatten it to a string and say what it means.
 */

export type FeedValueKind = "value" | "hash";

const VALUE_KIND_MEANING: Record<FeedValueKind, string> = {
  value: "`value` holds the raw oracle payload (<= 32 bytes), stored verbatim on-chain.",
  hash: "`value` holds a keccak digest of the payload; the preimage lives off-chain."
};

export function decodeFeedValueKind(feed: Record<string, unknown> | null | undefined): FeedValueKind | null {
  const raw = feed?.valueKind ?? (feed as Record<string, unknown> | undefined)?.value_kind;
  if (typeof raw === "string") {
    const lowered = raw.toLowerCase();
    return lowered === "value" || lowered === "hash" ? lowered : null;
  }

  if (raw && typeof raw === "object") {
    const key = Object.keys(raw as Record<string, unknown>)[0]?.toLowerCase();
    return key === "value" || key === "hash" ? key : null;
  }

  return null;
}

/** Feed account with `valueKind` flattened to a string and explained. */
export function presentFeed(
  feed: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!feed) {
    return null;
  }

  const kind = decodeFeedValueKind(feed);
  if (!kind) {
    return { ...feed };
  }

  return {
    ...feed,
    valueKind: kind,
    valueKindMeaning: VALUE_KIND_MEANING[kind]
  };
}

/**
 * Molpha attests *which encoding* the stored bytes use (`FeedValueKind` is only
 * `value | hash`) but not their scale: there is no decimals field on the Feed
 * account or in the signed DataUpdate. Any scale a consumer applies comes from
 * the off-chain apiConfig that produced the number, so report it as unsigned
 * provenance — verbatim, never parsed into a decimals count we cannot attest.
 */
export function describeValueEncoding(valueTransform: string | undefined): Record<string, unknown> {
  return {
    attested: false,
    source: "apiConfig.valueTransform (off-chain; not part of the signed payload)",
    valueTransform: valueTransform ?? null,
    note:
      "Molpha does not attest scale/decimals on-chain — FeedValueKind is only value|hash. A verifier contract must be configured with this feed's scale out of band; do not infer it from the integer alone."
  };
}
