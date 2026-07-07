import { Connection, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
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
  const solana = createSolanaClient(config, signer);

  return {
    config,
    gateway: createGateway(config, solana, signer),
    solana,
    signer
  };
}

export function createGateway(
  config: MolphaConfig,
  solana: Record<string, unknown>,
  signer: MolphaSigner
): Record<string, unknown> {
  const Gateway = requireSdkExport<new (...args: unknown[]) => Record<string, unknown>>("MolphaGateway");
  // SDK Signer type = (message: Uint8Array) => Promise<Uint8Array>
  const defaultSigner = (msg: Uint8Array) => signer.signMessage(msg);

  return new Gateway(
    config.gatewayEndpoints,
    () => requireMethod<[], Promise<number>>(solana, "getRegistryVersion")(),
    defaultSigner
  );
}

export function createSolanaClient(config: MolphaConfig, signer: MolphaSigner): Record<string, unknown> {
  const SolanaClient = requireSdkExport<{
    create: (opts: Record<string, unknown>) => Record<string, unknown>;
  }>("MolphaSolanaClient");
  const connection = new Connection(config.solanaRpc, "confirmed");
  const wallet = {
    publicKey: signer.publicKey,
    signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => signer.signTransaction(tx),
    signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => signer.signAllTransactions(txs),
  };

  return SolanaClient.create({
    connection,
    wallet,
    ...(config.programId ? { programId: new PublicKey(config.programId) } : {})
  });
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
