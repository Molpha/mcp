import type { Address } from "@solana/kit";
import { z } from "zod";
import { deriveFeedId, type ApiConfigLike } from "../apiconfig.js";
import { normalizeSignedResult, toDataUpdateArtifact } from "../artifacts.js";
import { getMolphaContext, requireMethod } from "../clients.js";
import { type MolphaConfig } from "../config.js";
import { settle } from "../errors.js";
import { normalizeFeedId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { prepareSignedResult, submitSignedResult } from "../submit.js";
import { readSubscriptionStatus } from "../subscription.js";
import { buildVerifierArgsForChains, type ChainTarget } from "../verifiers.js";
import { agentFetch } from "../x402.js";
import { apiConfigSchema } from "./schemas.js";
import { type ToolServer } from "./types.js";

const chainSchema = z.enum(["evm", "starknet", "solana"]);
const paymentSchema = z.enum(["auto", "subscription", "x402"]);

export function registerFetchVerifiedTool(server: ToolServer): void {
  server.registerTool(
    "molpha_fetch_verified",
    {
      title: "Fetch verified Molpha data",
      description:
        "Trigger a signing round for a feed and return the self-contained signed payload PLUS prebuilt verifier arguments for each requested chain. The signed payload is the trust anchor — verify it or forward it to a contract; do not consume `value` alone. Only the `solana` leg can be settled from this server (via `autoSubmit`, or by passing this tool's output to molpha_execute unmodified); `evm` and `starknet` return contract-ready calldata only — executing verify() there is the agent's job by design (see molpha_verify). `payment` selects how the round is paid for: \"subscription\" uses the caller's active USDC subscription (fails if inactive), \"x402\" self-funds a per-request escrow (auto-funds up to the MOLPHA_X402_MAX_PRICE_USDC / MOLPHA_X402_MAX_SPEND_PER_DAY_USDC caps), and \"auto\" (default) uses the subscription when active and falls back to x402 otherwise. feedId is derived from apiConfig + signaturesRequired + the signer's pubkey when omitted (see molpha_derive_feed).",
      inputSchema: {
        apiConfig: apiConfigSchema,
        signaturesRequired: z.number().int().positive().max(255).default(1),
        feedId: z.string().min(1).optional(),
        maxAge: z.number().int().nonnegative().optional(),
        chains: z.array(chainSchema).min(1),
        encryptSecrets: z.record(z.string()).optional(),
        payment: paymentSchema.optional(),
        autoSubmit: z
          .boolean()
          .optional()
          .describe(
            "Submit the signed DataUpdate to Solana in the same call, so a round-trip settle is one call instead of two. Requires \"solana\" in chains. Honours dryRun and the daily execute cap; a failed submit still returns the signed artifact so it can be retried via molpha_execute."
          ),
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
        autoSubmit = false,
        dryRun
      }: {
        apiConfig: z.infer<typeof apiConfigSchema>;
        signaturesRequired: number;
        feedId?: string;
        maxAge?: number;
        chains: ChainTarget[];
        encryptSecrets?: Record<string, string>;
        payment?: "auto" | "subscription" | "x402";
        autoSubmit?: boolean;
        dryRun?: boolean;
      }
    ) => {
      const { config, gateway, solana, signer, connection } = await getMolphaContext();
      const isDryRun = dryRun ?? config.guardrails.dryRunDefault;
      const resolvedFeedId = resolveFeedId(feedId, apiConfig, signaturesRequired, signer.publicKey);

      if (autoSubmit && !chains.includes("solana")) {
        throw new Error(
          "autoSubmit settles on Solana; include \"solana\" in chains (EVM/Starknet have no in-MCP execution path)."
        );
      }

      const resolvedPayment =
        payment === "auto" ? (await readSubscriptionStatus(solana)).active ? "subscription" : "x402" : payment;

      if (resolvedPayment === "x402" && encryptSecrets) {
        throw new Error(
          "encryptSecrets is not yet supported on the x402 payment path; use payment: \"subscription\", or omit encryptSecrets."
        );
      }

      if (resolvedPayment === "subscription") {
        if (isDryRun) {
          return {
            dryRun: true,
            action: "molpha_fetch_verified",
            payment: "subscription",
            feedId: resolvedFeedId,
            signaturesRequired,
            ...(autoSubmit ? { autoSubmit: "would submit the signed DataUpdate to Solana" } : {})
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

        return buildResult(result, chains, config, "subscription", autoSubmit);
      }

      const result = await agentFetch(
        { config, connection, signer, solana },
        {
          apiConfig,
          signaturesRequired,
          feedId: resolvedFeedId,
          ...(maxAge !== undefined ? { maxAge } : {}),
          ...(isDryRun ? { dryRun: true } : {})
        }
      );

      if (isDryRun) {
        return {
          payment: "x402",
          ...result,
          ...(autoSubmit ? { autoSubmit: "would submit the signed DataUpdate to Solana" } : {})
        };
      }

      return buildResult(result, chains, config, "x402", autoSubmit);
    })
  );
}

async function buildResult(
  result: Record<string, unknown>,
  chains: ChainTarget[],
  config: MolphaConfig,
  payment: "subscription" | "x402",
  autoSubmit: boolean
): Promise<Record<string, unknown>> {
  // Canonicalize once: the gateway emits minimal hex (a one-signer bitmap comes
  // back as "4"), which both the verifier-arg builders and submit_data_update
  // reject at their fixed widths.
  const normalized = normalizeSignedResult(result);
  const artifact = toDataUpdateArtifact(normalized);

  const out: Record<string, unknown> = {
    payment,
    ...artifact,
    trustAnchor:
      "Consume the signed dataUpdate + signature (and verify or forward). Do not trust `value` alone.",
    verifierArgs: buildVerifierArgsForChains(normalized, chains, config)
  };

  if (autoSubmit) {
    // A failed submit must not discard the signed artifact — the caller can
    // retry molpha_execute with the payload it is already holding.
    const submitted = await settle("solana.submitDataUpdate", async () =>
      submitSignedResult(prepareSignedResult(normalized))
    );
    out.submitted = submitted.ok
      ? submitted.value
      : {
          ok: false,
          ...submitted.error,
          retry: "Pass this response to molpha_execute unmodified to retry the Solana submit."
        };
  }

  return out;
}

function resolveFeedId(
  feedId: string | undefined,
  apiConfig: ApiConfigLike,
  signaturesRequired: number,
  owner: Address
): string {
  const derived = deriveFeedId(apiConfig, signaturesRequired, owner).feedId;
  if (feedId !== undefined && normalizeFeedId(feedId) !== normalizeFeedId(derived)) {
    throw new Error(
      `feedId does not match apiConfig + signaturesRequired for this signer: expected ${derived}, got ${feedId}`
    );
  }
  return derived;
}
