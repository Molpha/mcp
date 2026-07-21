import { z } from "zod";
import { getMolphaContext } from "../clients.js";
import { toolHandler } from "../mcp.js";
import { fetchAgentStatus } from "../x402.js";
import { type ToolServer } from "./types.js";

export function registerAgentStatusTool(server: ToolServer): void {
  server.registerTool(
    "molpha_agent_status",
    {
      title: "Get x402 agent escrow status",
      description:
        "Read the caller's x402 agent escrow (advisory: USDC ATA balance, amount committed to unsettled rounds, unsettled round count) and the next round's quoted price for a given quorum. Escrow is derived server-side per (payer, gateway). A non-existent escrow is normal pre-first-round — it's created lazily. Call before payment: \"x402\" fetches to see whether the escrow is already funded, or to pre-fund it out of band.",
      inputSchema: {
        signaturesRequired: z.number().int().positive().max(255).default(1)
      }
    },
    toolHandler(async ({ signaturesRequired }: { signaturesRequired: number }) => {
      const { config, signer } = await getMolphaContext();
      const status = await fetchAgentStatus(config, signer.publicKey, signaturesRequired);

      return {
        signaturesRequired,
        caps: {
          maxPriceUsdcAtomic: config.x402.maxPriceUsdcAtomic.toString(),
          maxSpendPerDayUsdcAtomic: config.x402.maxSpendPerDayUsdcAtomic.toString()
        },
        ...status,
        payer: signer.publicKey
      };
    })
  );
}
