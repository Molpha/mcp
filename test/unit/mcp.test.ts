import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { stringifyToolJson } from "../../src/mcp.js";

describe("stringifyToolJson", () => {
  it("serializes SDK-native values into MCP text JSON", () => {
    const json = stringifyToolJson({
      bigintValue: 42n,
      publicKey: new PublicKey("11111111111111111111111111111111"),
      bnValue: new BN("12345678901234567890"),
      bytes: new Uint8Array([0, 1, 254, 255])
    });

    expect(JSON.parse(json)).toEqual({
      bigintValue: "42",
      publicKey: "11111111111111111111111111111111",
      bnValue: "12345678901234567890",
      bytes: "0001feff"
    });
  });
});
