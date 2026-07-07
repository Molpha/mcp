import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { checkApiConfigDeterminism } from "../determinism.js";
import { enforceJobCreateCap, previewWrite } from "../guardrails.js";
import { toolHandler } from "../mcp.js";
import { requireSdkExport } from "../sdk.js";
import { assertActiveSubscription } from "../subscription.js";
import { type ToolServer } from "./types.js";

const apiConfigSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST"]).optional(),
  headers: z.record(z.string()).optional(),
  responseParser: z.string().min(1),
  valueTransform: z.string().optional()
});

export function registerCreateJobTool(server: ToolServer): void {
  server.registerTool(
    "molpha_create_job",
    {
      title: "Create Molpha job",
      description:
        "Register a data job from a declarative spec: which public HTTP API to fetch, how to parse and normalize the value, and the quorum. Returns a jobId. Requires an active USDC subscription (bootstrap via molpha-provision). Prefer settled/finalized data — independent nodes must converge on a byte-identical value to co-sign.",
      inputSchema: {
        apiConfig: apiConfigSchema,
        decimals: z.number().int().min(0).max(255),
        groupSize: z.number().int().positive().optional(),
        signaturesRequired: z.number().int().positive().max(255),
        rejectNonDeterministic: z.boolean().optional(),
        dryRun: z.boolean().optional()
      }
    },
    toolHandler(async (
      {
        apiConfig,
        decimals,
        groupSize,
        signaturesRequired,
        rejectNonDeterministic = false,
        dryRun
      }: {
        apiConfig: z.infer<typeof apiConfigSchema>;
        decimals: number;
        groupSize?: number;
        signaturesRequired: number;
        rejectNonDeterministic?: boolean;
        dryRun?: boolean;
      }
    ) => {
      const { config, solana, signer } = getMolphaContext();
      const determinism = checkApiConfigDeterminism(apiConfig);

      if (!determinism.ok && determinism.warnings.some((w) => w.includes("required"))) {
        throw new Error(determinism.warnings.join("; "));
      }

      if (rejectNonDeterministic && determinism.warnings.length > 0) {
        throw new Error(`Non-deterministic source rejected: ${determinism.warnings.join("; ")}`);
      }

      const deriveApiConfigHash = requireSdkExport<(cfg: Record<string, unknown>) => Uint8Array>("deriveApiConfigHash");
      const bytesToHex = requireSdkExport<(bytes: Uint8Array) => string>("bytesToHex");
      const apiConfigHash = deriveApiConfigHash(apiConfig);
      const subscription = await assertActiveSubscription(solana);

      const preview = {
        apiConfigHash: bytesToHex(apiConfigHash),
        decimals,
        signaturesRequired,
        groupSize,
        determinismWarnings: determinism.warnings,
        subscription,
        owner: signer.publicKey.toBase58()
      };

      const isDryRun = dryRun ?? config.guardrails.dryRunDefault;
      if (isDryRun) {
        return previewWrite("molpha_create_job", preview);
      }

      enforceJobCreateCap(config.guardrails);

      const createJob = requireMethod<
        [{ apiConfigHash: Uint8Array; signaturesRequired: number; decimals: number }],
        Promise<{ jobId: string; signature: string }>
      >(solana, "createJob");

      const job = await createJob({
        apiConfigHash,
        signaturesRequired,
        decimals
      });

      return {
        jobId: job.jobId,
        signature: job.signature,
        subscription: "active (devnet USDC, quota-based)",
        apiConfigHash: bytesToHex(apiConfigHash),
        determinismWarnings: determinism.warnings.length > 0 ? determinism.warnings : undefined,
        owner: signer.publicKey.toBase58()
      };
    })
  );
}
