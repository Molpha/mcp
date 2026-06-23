import { registerCreateJobTool } from "./create_job.js";
import { registerDescribeJobTool } from "./describe_job.js";
import { registerExecuteTool } from "./execute.js";
import { registerFetchVerifiedTool } from "./fetch_verified.js";
import { registerGetCapabilitiesTool } from "./get_capabilities.js";
import { registerGetLatestTool } from "./get_latest.js";
import { registerVerifyTool } from "./verify.js";
import { type ToolServer } from "./types.js";

export function registerTools(server: ToolServer): void {
  registerGetCapabilitiesTool(server);
  registerDescribeJobTool(server);
  registerCreateJobTool(server);
  registerFetchVerifiedTool(server);
  registerGetLatestTool(server);
  registerVerifyTool(server);
  registerExecuteTool(server);
}
