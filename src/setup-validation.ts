import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Connection } from "@solana/web3.js";
import { loadConfig, loadKeypair } from "./config.js";
import { createSigner } from "./signer/factory.js";

export interface SetupCheck {
  name: string;
  ok: boolean;
  message: string;
}

export function validateSignerEnv(env: NodeJS.ProcessEnv = process.env): SetupCheck[] {
  const backend = env.SIGNER_BACKEND ?? "memory";
  const checks: SetupCheck[] = [
    {
      name: "signer_backend",
      ok: backend === "memory" || backend === "keychain",
      message:
        backend === "memory" || backend === "keychain"
          ? `SIGNER_BACKEND=${backend}`
          : `unsupported SIGNER_BACKEND="${backend}" (expected memory or keychain)`
    }
  ];

  if (backend === "memory") {
    const ownerKeypair = env.OWNER_KEYPAIR ?? env.AGENT_KEYPAIR;
    if (!ownerKeypair?.trim()) {
      checks.push({
        name: "owner_keypair",
        ok: false,
        message: "OWNER_KEYPAIR is required for SIGNER_BACKEND=memory"
      });
      return checks;
    }

    if (isInlineKeypair(ownerKeypair)) {
      try {
        loadKeypair(ownerKeypair);
        checks.push({
          name: "owner_keypair",
          ok: true,
          message: "OWNER_KEYPAIR=<inline-json-keypair>"
        });
      } catch (error) {
        checks.push({
          name: "owner_keypair",
          ok: false,
          message:
            error instanceof Error
              ? `OWNER_KEYPAIR inline JSON is invalid: ${error.message}`
              : "OWNER_KEYPAIR inline JSON is invalid"
        });
      }
      return checks;
    }

    const resolved = resolveKeypairPath(ownerKeypair);
    if (!existsSync(resolved)) {
      checks.push({
        name: "owner_keypair",
        ok: false,
        message: `OWNER_KEYPAIR file not found: ${resolved}`
      });
      return checks;
    }

    checks.push({
      name: "owner_keypair",
      ok: true,
      message: `OWNER_KEYPAIR=${resolved}`
    });
    return checks;
  }

  const provider = env.KEYCHAIN_BACKEND;
  if (provider !== "privy" && provider !== "turnkey") {
    checks.push({
      name: "keychain_backend",
      ok: false,
      message: `KEYCHAIN_BACKEND must be privy or turnkey for SIGNER_BACKEND=keychain (got "${provider ?? ""}")`
    });
    return checks;
  }

  checks.push({
    name: "keychain_backend",
    ok: true,
    message: `KEYCHAIN_BACKEND=${provider}`
  });

  const required =
    provider === "privy"
      ? ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_WALLET_ID", "PRIVY_WALLET_ADDRESS"]
      : [
          "TURNKEY_API_PUBLIC_KEY",
          "TURNKEY_API_PRIVATE_KEY",
          "TURNKEY_ORGANIZATION_ID",
          "TURNKEY_WALLET_ADDRESS"
        ];

  for (const name of required) {
    const value = env[name];
    checks.push({
      name: name.toLowerCase(),
      ok: Boolean(value && value.trim().length > 0),
      message: value && value.trim().length > 0 ? `${name} is set` : `${name} is required for ${provider}`
    });
  }

  return checks;
}

export async function checkSignerAvailability(): Promise<SetupCheck> {
  try {
    const signer = createSigner(loadConfig());
    const available = await signer.isAvailable();
    return {
      name: "signer",
      ok: available,
      message: available
        ? `signer ready for ${signer.publicKey.toBase58()}`
        : "signer backend is not available"
    };
  } catch (error) {
    return {
      name: "signer",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function checkSolanaRpc(rpc: string): Promise<SetupCheck> {
  try {
    const connection = new Connection(rpc, "confirmed");
    const version = await connection.getVersion();
    return {
      name: "solana_rpc",
      ok: true,
      message: `reachable (${version["solana-core"] ?? "ok"})`
    };
  } catch (error) {
    return {
      name: "solana_rpc",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export function checkBuildArtifact(repoRoot = process.cwd()): SetupCheck {
  const built = resolve(repoRoot, "dist/src/server.js");
  return {
    name: "build",
    ok: existsSync(built),
    message: existsSync(built)
      ? `server entry found at ${built}`
      : `missing ${built} — run npm run build`
  };
}

export function resolveServerEntry(repoRoot = process.cwd()): string {
  return resolve(repoRoot, "dist/src/server.js");
}

export function buildMcpEnvBlock(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const config = loadConfig(env);
  const out: Record<string, string> = {
    SOLANA_RPC: config.solanaRpc,
    GATEWAY_ENDPOINTS: config.gatewayEndpoints.join(","),
    MOLPHA_EVM_NETWORKS: config.evmNetworks.join(","),
    MOLPHA_STARKNET_NETWORKS: config.starknetNetworks.join(","),
    MOLPHA_MAX_JOBS_PER_DAY: String(config.guardrails.maxJobsPerDay),
    MOLPHA_MAX_EXECUTES_PER_DAY: String(config.guardrails.maxExecutesPerDay)
  };

  const backend = env.SIGNER_BACKEND ?? "memory";
  if (backend === "memory") {
    out.SIGNER_BACKEND = "memory";
    const ownerKeypair = env.OWNER_KEYPAIR ?? env.AGENT_KEYPAIR;
    if (ownerKeypair) {
      out.OWNER_KEYPAIR = resolveKeypairPath(ownerKeypair);
    }
  } else {
    out.SIGNER_BACKEND = "keychain";
    const provider = env.KEYCHAIN_BACKEND;
    if (provider) {
      out.KEYCHAIN_BACKEND = provider;
    }

    const passthrough =
      provider === "privy"
        ? ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_WALLET_ID", "PRIVY_WALLET_ADDRESS"]
        : provider === "turnkey"
          ? [
              "TURNKEY_API_PUBLIC_KEY",
              "TURNKEY_API_PRIVATE_KEY",
              "TURNKEY_ORGANIZATION_ID",
              "TURNKEY_WALLET_ADDRESS"
            ]
          : [];

    for (const name of passthrough) {
      const value = env[name];
      if (value) {
        out[name] = value;
      }
    }
  }

  if (config.programId) {
    out.PROGRAM_ID = config.programId;
  }

  if (config.guardrails.dryRunDefault) {
    out.MOLPHA_DRY_RUN = "true";
  }

  return out;
}

export function buildMcpJsonSnippet(repoRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const serverPath = resolveServerEntry(repoRoot);
  return JSON.stringify(
    {
      mcpServers: {
        molpha: {
          command: "node",
          args: [serverPath],
          env: buildMcpEnvBlock(env)
        }
      }
    },
    null,
    2
  );
}

export function buildCodexTomlSnippet(repoRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const serverPath = resolveServerEntry(repoRoot);
  const envBlock = buildMcpEnvBlock(env);
  const lines = [
    "[mcp_servers.molpha]",
    `command = "node"`,
    `args = ["${serverPath}"]`,
    "",
    "[mcp_servers.molpha.env]"
  ];

  for (const [key, value] of Object.entries(envBlock)) {
    lines.push(`${key} = "${value.replaceAll('"', '\\"')}"`);
  }

  return `${lines.join("\n")}\n`;
}

function isInlineKeypair(pathOrJson: string): boolean {
  return pathOrJson.trim().startsWith("[");
}

function resolveKeypairPath(path: string): string {
  if (isInlineKeypair(path)) {
    return "<inline-json-keypair>";
  }

  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }

  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}
