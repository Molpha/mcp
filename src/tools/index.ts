import { registerAgentStatusTool } from "./agent_status.js";
import { registerDeriveFeedTool } from "./derive_feed.js";
import { registerDescribeFeedTool } from "./describe_feed.js";
import { registerExecuteTool } from "./execute.js";
import { registerFetchVerifiedTool } from "./fetch_verified.js";
import { registerGetCapabilitiesTool } from "./get_capabilities.js";
import { registerGetLatestTool } from "./get_latest.js";
import { registerVerifyTool } from "./verify.js";
import { type ToolServer } from "./types.js";

export function registerTools(server: ToolServer): void {
  registerGetCapabilitiesTool(server);
  registerDescribeFeedTool(server);
  registerDeriveFeedTool(server);
  registerAgentStatusTool(server);
  registerFetchVerifiedTool(server);
  registerGetLatestTool(server);
  registerVerifyTool(server);
  registerExecuteTool(server);
}
