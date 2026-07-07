import { z } from "zod";
import { toDataUpdateArtifact } from "../artifacts.js";
import { getMolphaContext, requireMethod } from "../clients.js";
import { normalizeJobId } from "../hex.js";
import { toolHandler } from "../mcp.js";
import { buildVerifierArgsForChains, type ChainTarget } from "../verifiers.js";
import { type ToolServer } from "./types.js";

const chainSchema = z.enum(["evm", "starknet", "solana"]);

export function registerFetchVerifiedTool(server: ToolServer): void {
  server.registerTool(
    "molpha_fetch_verified",
    {
      title: "Fetch verified Molpha data",
      description:
        "Trigger a signing round (or return a cached result within maxAge) for a job, and return the self-contained signed payload PLUS prebuilt verifier arguments for each requested chain. The signed payload is the trust anchor — verify it or forward it to a contract; do not consume `value` alone. Returns 402 if the subscription is inactive or out of quota.",
      inputSchema: {
        jobId: z.string().min(1),
        apiConfig: z.record(z.unknown()),
        maxAge: z.number().int().nonnegative().optional(),
        chains: z.array(chainSchema).min(1),
        encryptSecrets: z.record(z.string()).optional()
      }
    },
    toolHandler(async (
      {
        jobId,
        apiConfig,
        maxAge,
        chains,
        encryptSecrets
      }: {
        jobId: string;
        apiConfig: Record<string, unknown>;
        maxAge?: number;
        chains: ChainTarget[];
        encryptSecrets?: Record<string, string>;
      }
    ) => {
      const { config, gateway } = getMolphaContext();
      const requestSignedData = requireMethod<[Record<string, unknown>], Promise<Record<string, unknown>>>(
        gateway,
        "requestSignedData"
      );
      const result = await requestSignedData({
        jobId: normalizeJobId(jobId),
        apiConfig,
        ...(maxAge !== undefined ? { maxAge } : {}),
        ...(encryptSecrets ? { encrypt: { secrets: encryptSecrets } } : {})
      });

      const artifact = toDataUpdateArtifact(result);

      return {
        ...artifact,
        trustAnchor:
          "Consume the signed dataUpdate + signature (and verify or forward). Do not trust `value` alone.",
        verifierArgs: buildVerifierArgsForChains(result, chains, config)
      };
    })
  );
}
