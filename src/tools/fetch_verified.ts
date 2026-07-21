import { getAddressEncoder } from "@solana/kit";
import { z } from "zod";
import { sortApiConfigHeaders } from "../apiconfig.js";
import { toDataUpdateArtifact } from "../artifacts.js";
import { getMolphaContext, requireMethod } from "../clients.js";
import { type MolphaConfig } from "../config.js";
import { normalizeFeedId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { requireSdkExport } from "../sdk.js";
import { readSubscriptionStatus } from "../subscription.js";
import { buildVerifierArgsForChains, type ChainTarget } from "../verifiers.js";
import { agentFetch } from "../x402.js";
import { type ToolServer } from "./types.js";

const chainSchema = z.enum(["evm", "starknet", "solana"]);
const paymentSchema = z.enum(["auto", "subscription", "x402"]);

const apiConfigSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST"]).optional(),
  headers: z.record(z.string()).optional(),
  responseParser: z.string().min(1),
  valueTransform: z.string().optional()
});

export function registerFetchVerifiedTool(server: ToolServer): void {
  server.registerTool(
    "molpha_fetch_verified",
    {
      title: "Fetch verified Molpha data",
      description:
        "Trigger a signing round for a feed and return the self-contained signed payload PLUS prebuilt verifier arguments for each requested chain. The signed payload is the trust anchor — verify it or forward it to a contract; do not consume `value` alone. `payment` selects how the round is paid for: \"subscription\" uses the caller's active USDC subscription (fails if inactive), \"x402\" self-funds a per-request escrow (auto-funds up to the MOLPHA_X402_MAX_PRICE_USDC / MOLPHA_X402_MAX_SPEND_PER_DAY_USDC caps), and \"auto\" (default) uses the subscription when active and falls back to x402 otherwise. feedId is derived from apiConfig + signaturesRequired + the signer's pubkey when omitted (see molpha_derive_feed).",
      inputSchema: {
        apiConfig: apiConfigSchema,
        signaturesRequired: z.number().int().positive().max(255).default(1),
        feedId: z.string().min(1).optional(),
        maxAge: z.number().int().nonnegative().optional(),
        chains: z.array(chainSchema).min(1),
        encryptSecrets: z.record(z.string()).optional(),
        payment: paymentSchema.optional(),
        dryRun: z.boolean().optional()
      }
    },
    toolHandler(async (
      {
        apiConfig,
        signaturesRequired,
        feedId,
        maxAge,
        chains,
        encryptSecrets,
        payment = "auto",
        dryRun
      }: {
        apiConfig: z.infer<typeof apiConfigSchema>;
        signaturesRequired: number;
        feedId?: string;
        maxAge?: number;
        chains: ChainTarget[];
        encryptSecrets?: Record<string, string>;
        payment?: "auto" | "subscription" | "x402";
        dryRun?: boolean;
      }
    ) => {
      const { config, gateway, solana, signer, connection } = await getMolphaContext();
      const isDryRun = dryRun ?? config.guardrails.dryRunDefault;

      const resolvedPayment =
        payment === "auto" ? (await readSubscriptionStatus(solana)).active ? "subscription" : "x402" : payment;

      if (resolvedPayment === "x402" && encryptSecrets) {
        throw new Error(
          "encryptSecrets is not yet supported on the x402 payment path; use payment: \"subscription\", or omit encryptSecrets."
        );
      }

      if (resolvedPayment === "subscription") {
        const resolvedFeedId = feedId ?? deriveFeedId(apiConfig, signaturesRequired, Buffer.from(getAddressEncoder().encode(signer.publicKey)));

        if (isDryRun) {
          return {
            dryRun: true,
            action: "molpha_fetch_verified",
            payment: "subscription",
            feedId: resolvedFeedId,
            signaturesRequired
          };
        }

        const requestSignedData = requireMethod<[Record<string, unknown>], Promise<Record<string, unknown>>>(
          gateway,
          "requestSignedData"
        );
        const result = await requestSignedData({
          feedId: normalizeFeedId(resolvedFeedId),
          signaturesRequired,
          apiConfig,
          ...(maxAge !== undefined ? { maxAge } : {}),
          ...(encryptSecrets ? { encrypt: { secrets: encryptSecrets } } : {})
        });

        return buildResult(result, chains, config, "subscription");
      }

      const result = await agentFetch(
        { config, connection, signer, solana },
        {
          apiConfig,
          signaturesRequired,
          ...(maxAge !== undefined ? { maxAge } : {}),
          ...(isDryRun ? { dryRun: true } : {})
        }
      );

      if (isDryRun) {
        return { payment: "x402", ...result };
      }

      return buildResult(result, chains, config, "x402");
    })
  );
}

function buildResult(
  result: Record<string, unknown>,
  chains: ChainTarget[],
  config: MolphaConfig,
  payment: "subscription" | "x402"
): Record<string, unknown> {
  const artifact = toDataUpdateArtifact(result);

  return {
    payment,
    ...artifact,
    trustAnchor:
      "Consume the signed dataUpdate + signature (and verify or forward). Do not trust `value` alone.",
    verifierArgs: buildVerifierArgsForChains(result, chains, config)
  };
}

function deriveFeedId(
  apiConfig: z.infer<typeof apiConfigSchema>,
  signaturesRequired: number,
  owner: Uint8Array
): string {
  const canonicalizeAPIConfig = requireSdkExport<(cfg: Record<string, unknown>) => Record<string, unknown>>(
    "canonicalizeAPIConfig"
  );
  const deriveApiConfigHash = requireSdkExport<(cfg: Record<string, unknown>) => Uint8Array>("deriveApiConfigHash");
  const deriveFeedIdString = requireSdkExport<(owner: Uint8Array, hash: Uint8Array, sigs: number) => string>(
    "deriveFeedIdString"
  );

  const canonical = canonicalizeAPIConfig(sortApiConfigHeaders(apiConfig));
  const apiConfigHash = deriveApiConfigHash(canonical);
  return deriveFeedIdString(owner, apiConfigHash, signaturesRequired);
}
