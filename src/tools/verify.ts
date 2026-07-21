import { z } from "zod";
import { getMolphaContext } from "../clients.js";
import { toolHandler } from "../mcp.js";
import { buildVerifierArgsForChains, getVerifierMetadata, type ChainTarget } from "../verifiers.js";
import { type ToolServer } from "./types.js";

const chainSchema = z.enum(["evm", "starknet"]);

export function registerVerifyTool(server: ToolServer): void {
  server.registerTool(
    "molpha_verify",
    {
      title: "Verify Molpha result",
      description:
        "Build the verifier address and call args for a signed DataUpdate on EVM or Starknet, for the agent to execute the stateless verify() itself. The server does not vouch for results it did not verify on-chain. For Solana, submit the DataUpdate via molpha_execute (submit_data_update) and read it back with molpha_get_latest — there is no separate simulate-verify path.",
      inputSchema: {
        dataUpdate: z.record(z.unknown()),
        signature: z.record(z.unknown()),
        chain: chainSchema,
        includeAbi: z.boolean().optional()
      }
    },
    toolHandler(async (
      {
        dataUpdate,
        signature,
        chain,
        includeAbi = false
      }: {
        dataUpdate: Record<string, unknown>;
        signature: Record<string, unknown>;
        chain: ChainTarget;
        includeAbi?: boolean;
      }
    ) => {
      const { config } = await getMolphaContext();
      const result = fromArtifact(dataUpdate, signature);

      return {
        chain,
        verifierArgs: buildVerifierArgsForChains(result, [chain], config),
        note: "Execute verify() on-chain with the returned args; the MCP server does not assert validity.",
        verifiers: getVerifierMetadata(config, includeAbi)
      };
    })
  );
}

function fromArtifact(
  dataUpdate: Record<string, unknown>,
  signature: Record<string, unknown>
): Record<string, unknown> {
  return {
    feedId: dataUpdate.feedId,
    value: dataUpdate.value,
    valuePacked: dataUpdate.valuePacked ?? dataUpdate.value,
    timestamp: dataUpdate.canonicalTimestamp ?? dataUpdate.timestamp,
    registryVersion: dataUpdate.registryVersion,
    signaturesRequired: dataUpdate.signaturesRequired,
    signersBitmap: signature.signersBitmap,
    s: signature.signature ?? signature.s,
    commitmentAddr: signature.commitment ?? signature.commitmentAddr,
    fresh: true
  };
}
