import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("parses endpoint and verifier network csv values", () => {
    const config = loadConfig({
      GATEWAY_ENDPOINTS: "http://one.test, http://two.test",
      SOLANA_RPC: "http://solana.test",
      MOLPHA_EVM_NETWORKS: "evm-sepolia,arbitrum-sepolia",
      MOLPHA_STARKNET_NETWORKS: "starknet-sepolia"
    });

    expect(config.gatewayEndpoints).toEqual(["http://one.test", "http://two.test"]);
    expect(config.solanaRpc).toBe("http://solana.test");
    expect(config.evmNetworks).toEqual(["evm-sepolia", "arbitrum-sepolia"]);
    expect(config.starknetNetworks).toEqual(["starknet-sepolia"]);
    expect(config.guardrails.maxJobsPerDay).toBe(10);
  });
});
