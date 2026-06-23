import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { toolHandler } from "../mcp.js";
import { type ToolServer } from "./types.js";

export function registerGetLatestTool(server: ToolServer): void {
  server.registerTool(
    "molpha_get_latest",
    {
      title: "Get latest Molpha feed",
      description: "Read the latest on-chain feed account for a Molpha job.",
      inputSchema: {
        jobId: z.string().min(1)
      }
    },
    toolHandler(async ({ jobId }: { jobId: string }) => {
      const { solana } = getMolphaContext();
      const readFeed = requireMethod<[string], Promise<unknown>>(solana, "readFeed");

      return {
        jobId,
        feed: await readFeed(jobId)
      };
    })
  );
}
