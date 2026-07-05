/**
 * The gateway's REST surface (e.g. GET /v1/jobs/:id/config) expects a bare
 * hex jobId with no `0x` prefix, but jobIds are handed back to callers (job
 * creation output, on-chain reads) with the prefix attached. Passing a
 * prefixed jobId straight through causes the gateway to 400 on that lookup.
 *
 * Normalize once at the tool boundary so callers can pass either form.
 */
export function normalizeJobId(jobId: string): string {
  return jobId.startsWith("0x") || jobId.startsWith("0X") ? jobId.slice(2) : jobId;
}
