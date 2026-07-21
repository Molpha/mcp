import { z } from "zod";
import { getMolphaContext, requireMethod } from "../clients.js";
import { normalizeError } from "../errors.js";
import { toolHandler } from "../mcp.js";
import { getVerifierMetadata } from "../verifiers.js";
import { type ToolServer } from "./types.js";

export function registerGetCapabilitiesTool(server: ToolServer): void {
  server.registerTool(
    "molpha_get_capabilities",
    {
      title: "Get Molpha capabilities",
      description:
        "Returns the current Molpha verification surface: active registryVersion, registered node set, gateway endpoints, supported chains, signing scheme, and x402 spend caps. Call first to learn where a signed result can be verified.",
      inputSchema: {
        includeAbi: z.boolean().optional().describe("Include the EVM verifier ABI in the response.")
      }
    },
    toolHandler(async ({ includeAbi = false }: { includeAbi?: boolean }) => {
      const { config, gateway, solana } = await getMolphaContext();
      const [nodesResult, registryVersionResult] = await Promise.all([
        settle("gateway.getNodes", async () => requireMethod<[], Promise<unknown>>(gateway, "getNodes")()),
        settle("solana.getRegistryVersion", async () =>
          requireMethod<[], Promise<number>>(solana, "getRegistryVersion")()
        )
      ]);

      const nodes = nodesResult.ok ? (nodesResult.value as unknown[]) : [];
      const registryVersion = registryVersionResult.ok ? registryVersionResult.value : undefined;
      const verifiers = getVerifierMetadata(config, includeAbi);

      return {
        registryVersion,
        signingScheme: "PoP-Schnorr (secp256k1, two-nonce binding)",
        chains: {
          solana: "devnet (canonical state)",
          evm: config.evmNetworks,
          starknet: config.starknetNetworks
        },
        gateways: config.gatewayEndpoints,
        nodeCount: Array.isArray(nodes) ? nodes.length : 0,
        nodes: nodesResult,
        solanaRpc: config.solanaRpc,
        verifiers,
        payment: {
          modes: ["subscription", "x402", "auto"],
          x402Caps: {
            maxPriceUsdcAtomic: config.x402.maxPriceUsdcAtomic.toString(),
            maxSpendPerDayUsdcAtomic: config.x402.maxSpendPerDayUsdcAtomic.toString()
          }
        }
      };
    })
  );
}

async function settle(label: string, run: () => Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; label: string; error: ReturnType<typeof normalizeError> }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, label, error: normalizeError(error) };
  }
}
