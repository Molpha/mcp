/**
 * apiConfig canonicalization shared by feed derivation and the x402 client.
 *
 * The gateway's Go canonicalizer (`CanonicalAPIConfigHash`) marshals the
 * `headers` map with `encoding/json`, which always sorts map keys
 * alphabetically. The SDK's `canonicalizeAPIConfig`/`deriveApiConfigHash`
 * hash `JSON.stringify` of a plain JS object, which preserves insertion
 * order instead. Any caller that derives a feedId or apiConfigHash
 * client-side (feed derivation preview, x402 AgentRequestAuth signing) must
 * byte-match the gateway's hash, so headers are sorted here before handing
 * the config to the SDK's canonicalizer.
 */
export function sortApiConfigHeaders<T extends { headers?: Record<string, string> | undefined }>(apiConfig: T): T {
  if (!apiConfig.headers) {
    return apiConfig;
  }

  const headers = apiConfig.headers;
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(headers).sort()) {
    const value = headers[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }

  return { ...apiConfig, headers: sorted };
}
