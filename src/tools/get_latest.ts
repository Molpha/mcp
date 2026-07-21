import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { normalizeFeedId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { type ToolServer } from "./types.js";

export function registerGetLatestTool(server: ToolServer): void {
  server.registerTool(
    "molpha_get_latest",
    {
      title: "Get latest Molpha feed",
      description: "Read the latest on-chain feed account for a Molpha feedId.",
      inputSchema: {
        feedId: z.string().min(1)
      }
    },
    toolHandler(async ({ feedId }: { feedId: string }) => {
      const { solana } = await getMolphaContext();
      const readFeed = requireMethod<[string], Promise<unknown>>(solana, "readFeed");

      return {
        feedId,
        feed: await readFeed(normalizeFeedId(feedId))
      };
    })
  );
}
