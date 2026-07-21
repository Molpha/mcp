import { getAddressEncoder } from "@solana/kit";
import { z } from "zod";
import { sortApiConfigHeaders } from "../apiconfig.js";
import { getMolphaContext, requireMethod } from "../clients.js";
import { normalizeError } from "../errors.js";
import { normalizeFeedId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { requireSdkExport } from "../sdk.js";
import { type ToolServer } from "./types.js";

const apiConfigSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST"]).optional(),
  headers: z.record(z.string()).optional(),
  responseParser: z.string().min(1),
  valueTransform: z.string().optional()
});

export function registerDescribeFeedTool(server: ToolServer): void {
  server.registerTool(
    "molpha_describe_feed",
    {
      title: "Describe Molpha feed",
      description:
        "Read a feed's on-chain state (last committed value, registryVersion, signaturesRequired) and the caller's subscription status. Pass feedId directly, or apiConfig + signaturesRequired to derive it first (see molpha_derive_feed). A missing feed account is normal pre-first-settle — feeds are created lazily.",
      inputSchema: {
        feedId: z.string().min(1).optional(),
        apiConfig: apiConfigSchema.optional(),
        signaturesRequired: z.number().int().positive().max(255).optional()
      }
    },
    toolHandler(async (
      {
        feedId,
        apiConfig,
        signaturesRequired
      }: {
        feedId?: string;
        apiConfig?: z.infer<typeof apiConfigSchema>;
        signaturesRequired?: number;
      }
    ) => {
      const { config, solana, signer } = await getMolphaContext();

      let resolvedFeedId = feedId;
      if (!resolvedFeedId) {
        if (!apiConfig || signaturesRequired === undefined) {
          throw new Error("either feedId, or apiConfig + signaturesRequired, is required");
        }

        const canonicalizeAPIConfig = requireSdkExport<(cfg: Record<string, unknown>) => Record<string, unknown>>(
          "canonicalizeAPIConfig"
        );
        const deriveApiConfigHash = requireSdkExport<(cfg: Record<string, unknown>) => Uint8Array>(
          "deriveApiConfigHash"
        );
        const deriveFeedIdString = requireSdkExport<
          (owner: Uint8Array, hash: Uint8Array, sigs: number) => string
        >("deriveFeedIdString");

        const canonical = canonicalizeAPIConfig(sortApiConfigHeaders(apiConfig));
        const apiConfigHash = deriveApiConfigHash(canonical);
        resolvedFeedId = deriveFeedIdString(Buffer.from(getAddressEncoder().encode(signer.publicKey)), apiConfigHash, signaturesRequired);
      }

      const [onChainFeed, subscription] = await Promise.all([
        settle("solana.readFeed", async () =>
          requireMethod<[string], Promise<Record<string, unknown> | null>>(solana, "readFeed")(
            normalizeFeedId(resolvedFeedId!)
          )
        ),
        settle("solana.readSubscription", async () =>
          requireMethod<[], Promise<Record<string, unknown> | null>>(solana, "readSubscription")()
        )
      ]);

      return {
        feedId: resolvedFeedId,
        feed: onChainFeed,
        subscription,
        chains: {
          solana: "devnet (canonical state)",
          evm: config.evmNetworks,
          starknet: config.starknetNetworks
        }
      };
    })
  );
}

async function settle<T>(
  label: string,
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; label: string; error: ReturnType<typeof normalizeError> }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, label, error: normalizeError(error) };
  }
}
