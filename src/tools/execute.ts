import { z } from "zod";
import { getMolphaContext } from "../clients.js";
import { prepareSignedResult, previewSubmit, submitSignedResult } from "../submit.js";
import { toolHandler } from "../mcp.js";
import { type ToolServer } from "./types.js";

/** The flat gateway/SDK shape. */
const flatResultSchema = z.object({
  feedId: z.string().min(1),
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

/** The artifact shape `molpha_fetch_verified` returns, accepted verbatim. */
const artifactResultSchema = z.object({
  value: z.string().optional(),
  fresh: z.boolean().optional(),
  dataUpdate: z.object({
    feedId: z.string().min(1),
    registryVersion: z.number().int(),
    signaturesRequired: z.number().int(),
    value: z.string().optional(),
    valuePacked: z.string().optional(),
    canonicalTimestamp: z.number().int()
  }),
  signature: z.object({
    signature: z.string().min(1),
    commitment: z.string().min(1),
    signersBitmap: z.string().min(1)
  })
});

// Extra keys (`payment`, `trustAnchor`, `verifierArgs`) ride along on a pasted
// fetch_verified response; passthrough keeps that from being a validation error.
const signedResultSchema = z.union([
  artifactResultSchema.passthrough(),
  flatResultSchema.passthrough()
]);

export function registerExecuteTool(server: ToolServer): void {
  server.registerTool(
    "molpha_execute",
    {
      title: "Execute Molpha data update on Solana",
      description:
        "Submit a signed DataUpdate to the Solana feed via submit_data_update. Pass the output of molpha_fetch_verified through unmodified — both the artifact shape ({ dataUpdate, signature }) and the flat shape ({ s, commitmentAddr, timestamp }) are accepted, and short hex fields are zero-padded server-side. Permissionless on-chain; the owner key pays SOL fees. EVM/Starknet execution is deliberately out of scope (see molpha_verify) — use the verifier args from molpha_fetch_verified and call verify() yourself.",
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
        result: Record<string, unknown>;
        dryRun?: boolean;
      }
    ) => {
      const { config, signer } = await getMolphaContext();
      const isDryRun = dryRun ?? config.guardrails.dryRunDefault;
      const prepared = prepareSignedResult(result);

      if (isDryRun) {
        return previewSubmit("molpha_execute", prepared, String(signer.publicKey));
      }

      return submitSignedResult(prepared);
    })
  );
}
