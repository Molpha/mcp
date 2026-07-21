import { createHash } from "node:crypto";
import { address } from "@solana/kit";
import { Keypair, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MolphaConfig } from "../../src/config.js";
import { resetGuardrailCounters } from "../../src/guardrails.js";
import { type MolphaSigner } from "../../src/signer/types.js";
import { agentFetch, agentRequestAuthMessage, type AgentRequestAuthParams } from "../../src/x402.js";

function makeSigner(keypair: Keypair): MolphaSigner {
  return {
    publicKey: address(keypair.publicKey.toBase58()),
    async isAvailable() {
      return true;
    },
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof Transaction) {
        tx.sign(keypair);
      }
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof Transaction) tx.sign(keypair);
      }
      return txs;
    },
    async signMessage(): Promise<Uint8Array> {
      return new Uint8Array(64).fill(7);
    }
  };
}

// x402.ts caches the discovered gateway PDA per gateway endpoint at module
// scope; give every test its own endpoint so that cache can't leak state
// between tests sharing this file's module instance.
let gatewayEndpointCounter = 0;

function makeConfig(x402Overrides: Partial<MolphaConfig["x402"]> = {}): MolphaConfig {
  gatewayEndpointCounter += 1;
  return {
    gatewayEndpoints: [`http://gateway-${gatewayEndpointCounter}.test`],
    solanaRpc: "http://solana.test",
    ownerKeypair: undefined,
    evmNetworks: [],
    starknetNetworks: [],
    guardrails: { maxExecutesPerDay: 100, dryRunDefault: false },
    x402: {
      maxPriceUsdcAtomic: 10_000_000n,
      maxSpendPerDayUsdcAtomic: 100_000_000n,
      gatewayPda: undefined,
      ...x402Overrides
    }
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fakeConnection = {
  getLatestBlockhash: vi.fn(async () => ({
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 1
  })),
  sendRawTransaction: vi.fn(async () => "fake-signature"),
  confirmTransaction: vi.fn(async () => ({ value: { err: null } }))
};

describe("agentRequestAuthMessage", () => {
  it("matches sha256(domainPrefix || agent || gateway || feedId || ts_le || amount_le)", () => {
    const agent = Keypair.generate().publicKey;
    const gateway = Keypair.generate().publicKey;
    const feedId = new Uint8Array(32).fill(0xab);
    const params: AgentRequestAuthParams = {
      agent: address(agent.toBase58()),
      gateway: address(gateway.toBase58()),
      feedId,
      canonicalTimestamp: 1_700_000_000,
      amount: 1_234_567n
    };

    const tsBuf = Buffer.alloc(8);
    tsBuf.writeBigUInt64LE(BigInt(params.canonicalTimestamp));
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(params.amount);

    const expected = createHash("sha256")
      .update(
        Buffer.concat([
          Buffer.from("MOLPHA_AGENT_REQAUTH_V1", "utf8"),
          agent.toBuffer(),
          gateway.toBuffer(),
          Buffer.from(feedId),
          tsBuf,
          amountBuf
        ])
      )
      .digest();

    const actual = agentRequestAuthMessage(params);
    expect(Buffer.from(actual).equals(expected)).toBe(true);
    expect(actual.length).toBe(32);
  });
});

describe("agentFetch", () => {
  const payerKeypair = Keypair.generate();
  const signer = makeSigner(payerKeypair);
  const solana = { getRegistryVersion: async () => 1 };

  beforeEach(() => {
    resetGuardrailCounters();
    fakeConnection.getLatestBlockhash.mockClear();
    fakeConnection.sendRawTransaction.mockClear();
    fakeConnection.confirmTransaction.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dry-runs without any funding when the escrow already covers the quoted price", async () => {
    const gatewayPda = Keypair.generate().publicKey.toBase58();
    const config = makeConfig({ gatewayPda });
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain(`/v1/agent/${signer.publicKey}/status?signatures_required=1`);
      return jsonResponse(200, {
        payer: signer.publicKey,
        gateway: gatewayPda,
        escrow: "escrow-placeholder",
        exists: true,
        ataAddress: "ata-placeholder",
        ataExists: true,
        ataBalance: "5000000",
        committedAmount: "0",
        quotedNextPrice: "1000000",
        unsettledRounds: 0
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await agentFetch(
      { config, connection: fakeConnection as never, signer, solana },
      {
        apiConfig: { url: "https://api.example.com/v1/finalized/rate", responseParser: "$.rate" },
        signaturesRequired: 1,
        dryRun: true
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.shortfallAtomicUsdc).toBe("0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeConnection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("funds the escrow on 402, signs AgentRequestAuth, and returns the mapped result", async () => {
    const gatewayPubkey = Keypair.generate().publicKey.toBase58();
    const escrowPubkey = Keypair.generate().publicKey.toBase58();
    const mint = Keypair.generate().publicKey.toBase58();
    const escrowAta = Keypair.generate().publicKey.toBase58();
    const feedIdHex = "ab".repeat(32);
    const config = makeConfig();

    let executeCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/status")) {
        expect(href).toContain(`/v1/agent/${signer.publicKey}/status`);
        return jsonResponse(200, {
          payer: signer.publicKey,
          gateway: gatewayPubkey,
          escrow: escrowPubkey,
          exists: false,
          ataAddress: escrowAta,
          ataExists: false,
          ataBalance: "0",
          committedAmount: "0",
          quotedNextPrice: "1000000",
          unsettledRounds: 0
        });
      }

      executeCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      if (executeCalls === 1) {
        expect(body.amount).toBe(0);
        expect(body.agent_request_auth_sig).toBeUndefined();
        return jsonResponse(402, {
          x402Version: 1,
          error: "payment required: escrow ATA underfunded",
          accepts: [
            {
              scheme: "exact",
              network: "solana-devnet",
              maxAmountRequired: "1000000",
              payTo: escrowAta,
              asset: mint,
              resource: "/v1/agent/execute",
              description: "test",
              maxTimeoutSeconds: 60,
              extra: {
                agent: escrowPubkey,
                gateway: gatewayPubkey,
                feedId: feedIdHex,
                canonicalTimestamp: 1_700_000_000,
                amount: "1000000",
                payer: signer.publicKey,
                currentAtaBalance: "0",
                committedAmount: "0",
                note: "fund and retry"
              }
            }
          ]
        });
      }

      expect(body.amount).toBe(1000000);
      expect(typeof body.agent_request_auth_sig).toBe("string");
      expect(body.canonical_timestamp).toBe(1_700_000_000);
      return jsonResponse(200, {
        status: "completed",
        data: {
          feedId: feedIdHex,
          value: "42",
          valuePacked: "0".repeat(64),
          timestamp: 1_700_000_000,
          registryVersion: 1,
          signaturesRequired: 1,
          signersBitmap: "0".repeat(64),
          s: "0".repeat(64),
          commitmentAddr: "0".repeat(40),
          fresh: true
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await agentFetch(
      { config, connection: fakeConnection as never, signer, solana },
      {
        apiConfig: { url: "https://api.example.com/v1/finalized/rate", responseParser: "$.rate" },
        signaturesRequired: 1
      }
    );

    expect(result.value).toBe("42");
    expect(result.feedId).toBe(feedIdHex);
    expect(executeCalls).toBe(2);
    expect(fakeConnection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("uses status gateway + price when already funded (no unsigned discovery)", async () => {
    const gatewayPda = Keypair.generate().publicKey.toBase58();
    const escrowPubkey = Keypair.generate().publicKey.toBase58();
    const config = makeConfig(); // no pinned gateway PDA

    let executeCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/status")) {
        return jsonResponse(200, {
          payer: signer.publicKey,
          gateway: gatewayPda,
          escrow: escrowPubkey,
          exists: true,
          ataAddress: "ata-placeholder",
          ataExists: true,
          ataBalance: "250075",
          committedAmount: "0",
          quotedNextPrice: "50015",
          unsettledRounds: 0
        });
      }

      executeCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.amount).toBe(50015);
      expect(typeof body.agent_request_auth_sig).toBe("string");
      return jsonResponse(200, {
        status: "completed",
        data: {
          feedId: "cd".repeat(32),
          value: "99",
          valuePacked: "0".repeat(64),
          timestamp: body.canonical_timestamp,
          registryVersion: 1,
          signaturesRequired: 1,
          signersBitmap: "0".repeat(64),
          s: "0".repeat(64),
          commitmentAddr: "0".repeat(40),
          fresh: true
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await agentFetch(
      { config, connection: fakeConnection as never, signer, solana },
      {
        apiConfig: { url: "https://api.example.com/v1/finalized/rate", responseParser: "$.rate" },
        signaturesRequired: 1
      }
    );

    expect(result.value).toBe("99");
    expect(executeCalls).toBe(1);
    expect(fakeConnection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("bumps canonical_timestamp and retries once on 409 when already funded", async () => {
    const gatewayPda = Keypair.generate().publicKey.toBase58();
    const escrowPubkey = Keypair.generate().publicKey.toBase58();
    const config = makeConfig({ gatewayPda });

    const timestamps: number[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/status")) {
        return jsonResponse(200, {
          payer: signer.publicKey,
          gateway: gatewayPda,
          escrow: escrowPubkey,
          exists: true,
          ataAddress: Keypair.generate().publicKey.toBase58(),
          ataExists: true,
          ataBalance: "5000000",
          committedAmount: "0",
          quotedNextPrice: "1000000",
          unsettledRounds: 0
        });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      timestamps.push(body.canonical_timestamp as number);

      if (timestamps.length === 1) {
        return jsonResponse(409, { error: "canonical_timestamp already reserved" });
      }

      return jsonResponse(200, {
        status: "completed",
        data: {
          feedId: "cd".repeat(32),
          value: "7",
          valuePacked: "0".repeat(64),
          timestamp: body.canonical_timestamp,
          registryVersion: 1,
          signaturesRequired: 1,
          signersBitmap: "0".repeat(64),
          s: "0".repeat(64),
          commitmentAddr: "0".repeat(40),
          fresh: true
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await agentFetch(
      { config, connection: fakeConnection as never, signer, solana },
      {
        apiConfig: { url: "https://api.example.com/v1/finalized/rate", responseParser: "$.rate" },
        signaturesRequired: 1
      }
    );

    expect(result.value).toBe("7");
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]).toBe((timestamps[0] ?? 0) + 1);
    expect(fakeConnection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects a round priced above the per-round cap without funding the escrow", async () => {
    const config = makeConfig({ maxPriceUsdcAtomic: 500_000n });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/status")) {
        throw new Error("status unavailable");
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.amount).toBe(0);
      return jsonResponse(402, {
        x402Version: 1,
        error: "payment required: escrow ATA underfunded",
        accepts: [
          {
            scheme: "exact",
            network: "solana-devnet",
            maxAmountRequired: "1000000",
            payTo: Keypair.generate().publicKey.toBase58(),
            asset: Keypair.generate().publicKey.toBase58(),
            resource: "/v1/agent/execute",
            description: "test",
            maxTimeoutSeconds: 60,
            extra: {
              agent: Keypair.generate().publicKey.toBase58(),
              gateway: Keypair.generate().publicKey.toBase58(),
              feedId: "ab".repeat(32),
              canonicalTimestamp: 1_700_000_000,
              amount: "1000000",
              payer: signer.publicKey,
              currentAtaBalance: "0",
              committedAmount: "0",
              note: "fund and retry"
            }
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      agentFetch(
        { config, connection: fakeConnection as never, signer, solana },
        {
          apiConfig: { url: "https://api.example.com/v1/finalized/rate", responseParser: "$.rate" },
          signaturesRequired: 1
        }
      )
    ).rejects.toThrow(/cap reached/);

    expect(fakeConnection.sendRawTransaction).not.toHaveBeenCalled();
  });
});
