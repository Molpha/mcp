import { getAddressEncoder, type Address } from "@solana/kit";
import { requireSdkExport } from "./sdk.js";

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

export interface ApiConfigLike {
  url: string;
  method?: "GET" | "POST" | undefined;
  headers?: Record<string, string> | undefined;
  responseParser: string;
  valueTransform?: string | undefined;
}

/** Sorts headers, then hands the config to the SDK's canonicalizer (see above for why). */
export function canonicalizeApiConfig(apiConfig: ApiConfigLike): Record<string, unknown> {
  const canonicalize = requireSdkExport<(cfg: Record<string, unknown>) => Record<string, unknown>>(
    "canonicalizeAPIConfig"
  );
  return canonicalize(sortApiConfigHeaders(apiConfig) as unknown as Record<string, unknown>);
}

export function deriveApiConfigHash(canonicalApiConfig: Record<string, unknown>): Uint8Array {
  return requireSdkExport<(cfg: Record<string, unknown>) => Uint8Array>("deriveApiConfigHash")(canonicalApiConfig);
}

export function deriveFeedIdString(owner: Address, apiConfigHash: Uint8Array, signaturesRequired: number): string {
  const derive = requireSdkExport<(owner: Uint8Array, hash: Uint8Array, sigs: number) => string>(
    "deriveFeedIdString"
  );
  return derive(Buffer.from(getAddressEncoder().encode(owner)), apiConfigHash, signaturesRequired);
}

export interface DerivedFeedId {
  feedId: string;
  apiConfigHash: Uint8Array;
  canonicalApiConfig: Record<string, unknown>;
}

/** Full feedId derivation: canonicalize -> hash -> feedId, for a given owner + quorum. */
export function deriveFeedId(apiConfig: ApiConfigLike, signaturesRequired: number, owner: Address): DerivedFeedId {
  const canonicalApiConfig = canonicalizeApiConfig(apiConfig);
  const apiConfigHash = deriveApiConfigHash(canonicalApiConfig);
  const feedId = deriveFeedIdString(owner, apiConfigHash, signaturesRequired);
  return { feedId, apiConfigHash, canonicalApiConfig };
}
