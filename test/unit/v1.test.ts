import { describe, expect, it } from "vitest";
import { toDataUpdateArtifact } from "../../src/artifacts.js";
import { loadConfig } from "../../src/config.js";
import { checkApiConfigDeterminism } from "../../src/determinism.js";
import { normalizeError } from "../../src/errors.js";
import { enforceExecuteCap, enforceJobCreateCap, resetGuardrailCounters } from "../../src/guardrails.js";
import { buildVerifierArgsForChains } from "../../src/verifiers.js";

describe("loadConfig", () => {
  it("parses endpoint, verifier networks, and guardrails", () => {
    const config = loadConfig({
      GATEWAY_ENDPOINTS: "http://one.test, http://two.test",
      SOLANA_RPC: "http://solana.test",
      OWNER_KEYPAIR: "./owner.json",
      MOLPHA_EVM_NETWORKS: "evm-sepolia,arbitrum-sepolia",
      MOLPHA_STARKNET_NETWORKS: "starknet-sepolia",
      MOLPHA_MAX_JOBS_PER_DAY: "5",
      MOLPHA_MAX_EXECUTES_PER_DAY: "20",
      MOLPHA_DRY_RUN: "true"
    });

    expect(config.gatewayEndpoints).toEqual(["http://one.test", "http://two.test"]);
    expect(config.solanaRpc).toBe("http://solana.test");
    expect(config.ownerKeypair).toBe("./owner.json");
    expect(config.evmNetworks).toEqual(["evm-sepolia", "arbitrum-sepolia"]);
    expect(config.starknetNetworks).toEqual(["starknet-sepolia"]);
    expect(config.guardrails).toEqual({
      maxJobsPerDay: 5,
      maxExecutesPerDay: 20,
      dryRunDefault: true
    });
  });

  it("accepts AGENT_KEYPAIR as deprecated alias for OWNER_KEYPAIR", () => {
    const config = loadConfig({ AGENT_KEYPAIR: "./legacy.json" });
    expect(config.ownerKeypair).toBe("./legacy.json");
  });
});

describe("toDataUpdateArtifact", () => {
  it("shapes gateway result into spec-friendly signed artifact", () => {
    const artifact = toDataUpdateArtifact({
      jobId: "0xabc",
      value: "123",
      fresh: true,
      registryVersion: 42,
      signaturesRequired: 3,
      timestamp: 1714300000,
      s: "0xsig",
      commitmentAddr: "0xcommit",
      signersBitmap: "0xbitmap"
    });

    expect(artifact).toEqual({
      value: "123",
      fresh: true,
      dataUpdate: {
        jobId: "0xabc",
        registryVersion: 42,
        signaturesRequired: 3,
        value: "123",
        canonicalTimestamp: 1714300000
      },
      signature: {
        signature: "0xsig",
        commitment: "0xcommit",
        signersBitmap: "0xbitmap"
      }
    });
  });
});

describe("checkApiConfigDeterminism", () => {
  it("warns on live-drifting URLs", () => {
    const result = checkApiConfigDeterminism({
      url: "https://api.example.com/ticker/BTC",
      responseParser: "$.price"
    });

    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("passes settled sources", () => {
    const result = checkApiConfigDeterminism({
      url: "https://api.example.com/v1/finalized/rate",
      responseParser: "$.rate"
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("guardrails", () => {
  it("enforces daily job and execute caps", () => {
    resetGuardrailCounters();
    const guardrails = { maxJobsPerDay: 1, maxExecutesPerDay: 1, dryRunDefault: false };

    enforceJobCreateCap(guardrails);
    expect(() => enforceJobCreateCap(guardrails)).toThrow(/cap reached/);

    resetGuardrailCounters();
    enforceExecuteCap(guardrails);
    expect(() => enforceExecuteCap(guardrails)).toThrow(/cap reached/);
  });
});

describe("normalizeError", () => {
  it("maps subscription and config errors with remediation", () => {
    expect(normalizeError(new Error("OWNER_KEYPAIR is required")).code).toBe("missing_config");
    expect(normalizeError(new Error("Subscription expired")).remediation).toContain("bootstrap");
    expect(normalizeError(new Error("job creation cap reached (10 per day)")).code).toBe("guardrail_exceeded");
  });
});

describe("buildVerifierArgsForChains", () => {
  it("includes evm verifier metadata when requested", () => {
    const result = {
      jobId: "0".repeat(64),
      value: "1",
      valuePacked: "0".repeat(64),
      timestamp: 1,
      registryVersion: 1,
      signaturesRequired: 1,
      signersBitmap: "0".repeat(64),
      s: "0".repeat(64),
      commitmentAddr: "0".repeat(40),
      fresh: true
    };

    const args = buildVerifierArgsForChains(result, ["evm"], {
      gatewayEndpoints: ["http://gateway.test"],
      solanaRpc: "http://solana.test",
      ownerKeypair: undefined,
      programId: undefined,
      evmNetworks: ["evm-sepolia"],
      starknetNetworks: [],
      guardrails: { maxJobsPerDay: 10, maxExecutesPerDay: 100, dryRunDefault: false }
    });

    expect(args.evm).toBeDefined();
    expect((args.evm as { chainIds: number[] }).chainIds).toContain(11155111);
  });
});
