import { describe, expect, it } from "vitest";
import { buildMcpEnvBlock, validateSignerEnv } from "../../src/setup-validation.js";

describe("validateSignerEnv", () => {
  it("requires OWNER_KEYPAIR for memory backend", () => {
    const checks = validateSignerEnv({ SIGNER_BACKEND: "memory" });
    expect(checks.find((check) => check.name === "owner_keypair")?.ok).toBe(false);
  });

  it("requires privy vars for keychain privy backend", () => {
    const checks = validateSignerEnv({
      SIGNER_BACKEND: "keychain",
      KEYCHAIN_BACKEND: "privy"
    });

    expect(checks.find((check) => check.name === "keychain_backend")?.ok).toBe(true);
    expect(checks.find((check) => check.name === "privy_app_id")?.ok).toBe(false);
    expect(checks.find((check) => check.name === "privy_app_secret")?.ok).toBe(false);
  });

  it("builds memory env block with absolute owner keypair path", () => {
    const env = buildMcpEnvBlock({
      SIGNER_BACKEND: "memory",
      OWNER_KEYPAIR: "/tmp/owner.json",
      SOLANA_RPC: "https://api.devnet.solana.com"
    });

    expect(env.SIGNER_BACKEND).toBe("memory");
    expect(env.OWNER_KEYPAIR).toBe("/tmp/owner.json");
    expect(env.SOLANA_RPC).toBe("https://api.devnet.solana.com");
  });
});
