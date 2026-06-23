import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { normalizeError } from "../errors.js";
import { toolHandler } from "../mcp.js";
import { getVerifierMetadata } from "../verifiers.js";
import { type ToolServer } from "./types.js";

export function registerDescribeJobTool(server: ToolServer): void {
  server.registerTool(
    "molpha_describe_job",
    {
      title: "Describe Molpha job",
      description:
        "Given a jobId, return its committed config (apiConfigHash, valuePolicy, decimals), quorum (groupSize / signaturesRequired), subscription status, and the chains its signed results verify on.",
      inputSchema: {
        jobId: z.string().min(1),
        includeGatewayConfig: z.boolean().optional()
      }
    },
    toolHandler(async (
      { jobId, includeGatewayConfig = true }: { jobId: string; includeGatewayConfig?: boolean }
    ) => {
      const { config, gateway, solana } = getMolphaContext();
      const onChainJob = await settle("solana.readJob", async () =>
        requireMethod<[string], Promise<Record<string, unknown> | null>>(solana, "readJob")(jobId)
      );

      const gatewayConfig = includeGatewayConfig
        ? await settle("gateway.getJobConfig", async () =>
            requireMethod<[string], Promise<unknown>>(gateway, "getJobConfig")(jobId)
          )
        : { ok: false, skipped: true };

      const subscription = await settle("solana.readSubscription", async () =>
        requireMethod<[], Promise<Record<string, unknown> | null>>(solana, "readSubscription")()
      );

      const job =
        onChainJob.ok && onChainJob.value && typeof onChainJob.value === "object"
          ? (onChainJob.value as Record<string, unknown>)
          : null;

      return {
        jobId,
        apiConfigHash: job?.apiConfigHash,
        decimals: job?.decimals,
        signaturesRequired: job?.signaturesRequired,
        owner: job?.owner?.toString?.() ?? job?.owner,
        createdAt: job?.createdAt?.toString?.() ?? job?.createdAt,
        subscription,
        chains: {
          solana: "devnet (simulate-verify)",
          evm: config.evmNetworks,
          starknet: config.starknetNetworks
        },
        onChainJob,
        gatewayConfig
      };
    })
  );
}

async function settle<T>(
  label: string,
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; label: string; error: ReturnType<typeof normalizeError> }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, label, error: normalizeError(error) };
  }
}
