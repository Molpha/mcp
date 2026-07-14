import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { getSdkExport } from "./sdk.js";

const DEFAULT_SOLANA_RPC = "https://api.devnet.solana.com";
const FALLBACK_GATEWAY_ENDPOINT = "https://gateway.molpha.io";

export interface GuardrailConfig {
  maxJobsPerDay: number;
  maxExecutesPerDay: number;
  dryRunDefault: boolean;
}

export interface MolphaConfig {
  gatewayEndpoints: string[];
  solanaRpc: string;
  ownerKeypair: string | undefined;
  programId: string | undefined;
  evmNetworks: string[];
  starknetNetworks: string[];
  guardrails: GuardrailConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MolphaConfig {
  const sdkDefaultGateway = getSdkExport<string>("DEFAULT_GATEWAY_ENDPOINT");

  return {
    gatewayEndpoints: parseCsv(env.GATEWAY_ENDPOINTS ?? sdkDefaultGateway ?? FALLBACK_GATEWAY_ENDPOINT),
    solanaRpc: env.SOLANA_RPC ?? DEFAULT_SOLANA_RPC,
    ownerKeypair: emptyToUndefined(env.OWNER_KEYPAIR ?? env.AGENT_KEYPAIR),
    programId: emptyToUndefined(env.PROGRAM_ID),
    evmNetworks: parseCsv(env.MOLPHA_EVM_NETWORKS ?? "evm-sepolia"),
    starknetNetworks: parseCsv(env.MOLPHA_STARKNET_NETWORKS ?? "starknet-sepolia"),
    guardrails: {
      maxJobsPerDay: parsePositiveInt(env.MOLPHA_MAX_JOBS_PER_DAY, 10),
      maxExecutesPerDay: parsePositiveInt(env.MOLPHA_MAX_EXECUTES_PER_DAY, 100),
      dryRunDefault: env.MOLPHA_DRY_RUN === "1" || env.MOLPHA_DRY_RUN === "true"
    }
  };
}

export function loadOwnerKeypair(config: MolphaConfig): Keypair {
  if (!config.ownerKeypair) {
    throw new Error("OWNER_KEYPAIR is required for the Molpha MCP runtime (Model A owner key)");
  }

  return loadKeypair(config.ownerKeypair);
}

/** @deprecated Use loadOwnerKeypair — AGENT_KEYPAIR alias retained for compatibility. */
export function loadAgentKeypair(config: MolphaConfig): Keypair {
  return loadOwnerKeypair(config);
}

export function loadKeypair(pathOrJson: string): Keypair {
  const raw = pathOrJson.trim().startsWith("[")
    ? pathOrJson
    : readFileSync(resolvePath(pathOrJson), "utf8");
  const secretKey = JSON.parse(raw) as number[];

  if (!Array.isArray(secretKey)) {
    throw new Error("keypair must be a JSON array of secret-key bytes");
  }

  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got "${value}"`);
  }

  return parsed;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function resolvePath(path: string): string {
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}
