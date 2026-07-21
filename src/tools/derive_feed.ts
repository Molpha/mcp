import { z } from "zod";
import { deriveFeedId } from "../apiconfig.js";
import { getMolphaContext } from "../clients.js";
import { checkApiConfigDeterminism } from "../determinism.js";
import { toolHandler } from "../mcp.js";
import { requireSdkExport } from "../sdk.js";
import { apiConfigSchema } from "./schemas.js";
import { type ToolServer } from "./types.js";

export function registerDeriveFeedTool(server: ToolServer): void {
  server.registerTool(
    "molpha_derive_feed",
    {
      title: "Derive Molpha feedId",
      description:
        "Locally derive the feedId for a declarative spec (apiConfig + quorum) — no transaction, no subscription required. feedId = keccak256(owner || apiConfigHash || signaturesRequired); the feed itself is created lazily on-chain at first settle (subscription or x402 round). Call this to preview a feedId before molpha_fetch_verified, or to check what feedId a given spec resolves to for the current signer. Prefer settled/finalized data — independent nodes must converge on a byte-identical value to co-sign.",
      inputSchema: {
        apiConfig: apiConfigSchema,
        signaturesRequired: z.number().int().positive().max(255),
        rejectNonDeterministic: z.boolean().optional()
      }
    },
    toolHandler(async (
      {
        apiConfig,
        signaturesRequired,
        rejectNonDeterministic = false
      }: {
        apiConfig: z.infer<typeof apiConfigSchema>;
        signaturesRequired: number;
        rejectNonDeterministic?: boolean;
      }
    ) => {
      const { signer } = await getMolphaContext();
      const determinism = checkApiConfigDeterminism(apiConfig);

      if (!determinism.ok && determinism.warnings.some((w) => w.includes("required"))) {
        throw new Error(determinism.warnings.join("; "));
      }

      if (rejectNonDeterministic && determinism.warnings.length > 0) {
        throw new Error(`Non-deterministic source rejected: ${determinism.warnings.join("; ")}`);
      }

      const bytesToHex = requireSdkExport<(bytes: Uint8Array) => string>("bytesToHex");
      const { feedId, apiConfigHash, canonicalApiConfig } = deriveFeedId(
        apiConfig,
        signaturesRequired,
        signer.publicKey
      );

      return {
        feedId,
        apiConfigHash: bytesToHex(apiConfigHash),
        canonicalApiConfig,
        signaturesRequired,
        owner: signer.publicKey,
        determinismWarnings: determinism.warnings.length > 0 ? determinism.warnings : undefined,
        note:
          "No transaction was sent. The feed account is created lazily on first settle via molpha_fetch_verified (subscription or x402)."
      };
    })
  );
}
