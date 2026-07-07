import { Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, type Keypair as SolanaKeypair } from "@solana/web3.js";
import { loadConfig, type MolphaConfig } from "./config.js";
import { getSdkExport, requireSdkExport } from "./sdk.js";
import { createSigner } from "./signer/factory.js";
import type { MolphaSigner } from "./signer/types.js";

export interface MolphaContext {
  config: MolphaConfig;
  gateway: Record<string, unknown>;
  solana: Record<string, unknown>;
  signer: MolphaSigner;
}

let cachedContext: MolphaContext | undefined;

export function getMolphaContext(): MolphaContext {
  cachedContext ??= createMolphaContext(loadConfig());
  return cachedContext;
}

export function createMolphaContext(config: MolphaConfig): MolphaContext {
  const signer = createSigner(config);
  const solana = createSolanaClient(config, signer.keypair);

  return {
    config,
    gateway: createGateway(config, solana, signer.keypair),
    solana,
    signer
  };
}

export function createGateway(
  config: MolphaConfig,
  solana: Record<string, unknown>,
  ownerKeypair: SolanaKeypair
): Record<string, unknown> {
  const Gateway = requireSdkExport<new (...args: unknown[]) => Record<string, unknown>>("MolphaGateway");
  const gatewaySignerFromWallet = getSdkExport<(wallet: Wallet) => unknown>("gatewaySignerFromWallet");
  const wallet = new Wallet(ownerKeypair);
  const defaultSigner =
    typeof gatewaySignerFromWallet === "function" ? gatewaySignerFromWallet(wallet) : createRequestSigner(ownerKeypair);

  return new Gateway(
    config.gatewayEndpoints,
    () => requireMethod<[], Promise<number>>(solana, "getRegistryVersion")(),
    defaultSigner
  );
}

export function createSolanaClient(config: MolphaConfig, signer: SolanaKeypair): Record<string, unknown> {
  const SolanaClient = requireSdkExport<{
    create: (opts: Record<string, unknown>) => Record<string, unknown>;
  }>("MolphaSolanaClient");
  const connection = new Connection(config.solanaRpc, "confirmed");
  const wallet = new Wallet(signer);

  return SolanaClient.create({
    connection,
    wallet,
    ...(config.programId ? { programId: new PublicKey(config.programId) } : {})
  });
}

export function createRequestSigner(keypair: SolanaKeypair): unknown {
  const signerFromKeypair = getSdkExport<(keypair: SolanaKeypair) => unknown>("signerFromKeypair");
  if (typeof signerFromKeypair === "function") {
    return signerFromKeypair(keypair);
  }

  return keypair;
}

export function requireMethod<TArgs extends unknown[], TResult>(
  target: Record<string, unknown>,
  methodName: string
): (...args: TArgs) => TResult {
  const method = target[methodName];
  if (typeof method !== "function") {
    throw new Error(`Molpha SDK client is missing ${methodName}()`);
  }

  return method.bind(target) as (...args: TArgs) => TResult;
}
