/**
 * The gateway's REST surface (e.g. subscription round execute) expects a
 * bare hex feedId with no `0x` prefix, but feedIds are handed back to callers
 * (feed derivation output, on-chain reads) with the prefix attached. Passing a
 * prefixed feedId straight through causes the gateway to 400 on that lookup.
 *
 * Normalize once at the tool boundary so callers can pass either form.
 */
export function normalizeFeedId(feedId: string): string {
  return feedId.startsWith("0x") || feedId.startsWith("0X") ? feedId.slice(2) : feedId;
}
