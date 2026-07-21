import { z } from "zod";
import { deriveFeedId } from "../apiconfig.js";
import { getMolphaContext, requireMethod } from "../clients.js";
import { settle } from "../errors.js";
import { describeValueEncoding, presentFeed } from "../feed.js";
import { normalizeFeedId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { apiConfigSchema } from "./schemas.js";
import { type ToolServer } from "./types.js";

export function registerDescribeFeedTool(server: ToolServer): void {
  server.registerTool(
    "molpha_describe_feed",
    {
      title: "Describe Molpha feed",
      description:
        "Read a feed's on-chain state (last committed value, registryVersion, signaturesRequired) and the caller's subscription status. Pass feedId directly, or apiConfig + signaturesRequired to derive it first (see molpha_derive_feed). A missing feed account is normal pre-first-settle — feeds are created lazily. `feed.valueKind` is the attested encoding of the stored bytes (\"value\" = raw payload, \"hash\" = keccak digest), NOT a scale hint: Molpha attests no decimals on-chain. When apiConfig is supplied, `valueEncoding` reports the off-chain valueTransform that produced the number, explicitly flagged as unattested.",
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

        resolvedFeedId = deriveFeedId(apiConfig, signaturesRequired, signer.publicKey).feedId;
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
        feed: onChainFeed.ok ? presentFeed(onChainFeed.value) : onChainFeed,
        ...(apiConfig ? { valueEncoding: describeValueEncoding(apiConfig.valueTransform) } : {}),
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
