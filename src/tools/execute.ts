import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { enforceExecuteCap, previewWrite } from "../guardrails.js";
import { toolHandler } from "../mcp.js";
import { type ToolServer } from "./types.js";

const signedResultSchema = z.object({
  jobId: z.string().min(1),
  value: z.string().optional(),
  valuePacked: z.string().optional(),
  timestamp: z.number().int(),
  registryVersion: z.number().int(),
  signaturesRequired: z.number().int(),
  signersBitmap: z.string().min(1),
  s: z.string().min(1),
  commitmentAddr: z.string().min(1),
  fresh: z.boolean().optional()
});

export function registerExecuteTool(server: ToolServer): void {
  server.registerTool(
    "molpha_execute",
    {
      title: "Execute Molpha data update on Solana",
      description:
        "Submit a signed DataUpdate to the Solana feed via submit_data_update. Permissionless on-chain; the owner key pays SOL fees. EVM/Starknet execution is deferred — use verifier args from molpha_fetch_verified.",
      inputSchema: {
        result: signedResultSchema,
        dryRun: z.boolean().optional()
      }
    },
    toolHandler(async (
      {
        result,
        dryRun
      }: {
        result: z.infer<typeof signedResultSchema>;
        dryRun?: boolean;
      }
    ) => {
      const { config, solana, signer } = getMolphaContext();
      const isDryRun = dryRun ?? config.guardrails.dryRunDefault;

      if (isDryRun) {
        return previewWrite("molpha_execute", {
          chain: "solana",
          action: "submit_data_update",
          jobId: result.jobId,
          registryVersion: result.registryVersion,
          submitter: signer.publicKey.toBase58()
        });
      }

      enforceExecuteCap(config.guardrails);

      const submitDataUpdate = requireMethod<
        [Record<string, unknown>],
        Promise<{ signature: string }>
      >(solana, "submitDataUpdate");

      const tx = await submitDataUpdate(result);

      return {
        chain: "solana",
        action: "submit_data_update",
        jobId: result.jobId,
        signature: tx.signature
      };
    })
  );
}
