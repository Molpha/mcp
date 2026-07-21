import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { presentFeed } from "../feed.js";
import { normalizeFeedId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { type ToolServer } from "./types.js";

export function registerGetLatestTool(server: ToolServer): void {
  server.registerTool(
    "molpha_get_latest",
    {
      title: "Get latest Molpha feed",
      description:
        "Read the latest on-chain feed account for a Molpha feedId. `valueKind` is the attested encoding of the stored bytes (\"value\" = raw payload, \"hash\" = keccak digest) — it is not a scale hint. Molpha does not attest decimals on-chain; see molpha_describe_feed's valueEncoding for the (unsigned) apiConfig provenance.",
      inputSchema: {
        feedId: z.string().min(1)
      }
    },
    toolHandler(async ({ feedId }: { feedId: string }) => {
      const { solana } = await getMolphaContext();
      const readFeed = requireMethod<[string], Promise<Record<string, unknown> | null>>(
        solana,
        "readFeed"
      );

      return {
        feedId,
        feed: presentFeed(await readFeed(normalizeFeedId(feedId)))
      };
    })
  );
}
