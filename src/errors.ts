export interface NormalizedToolError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  remediation?: string;
}

export type SettleResult<T> =
  | { ok: true; value: T }
  | { ok: false; label: string; error: NormalizedToolError };

/** Runs `run()`, capturing a failure as a normalized error instead of throwing. */
export async function settle<T>(label: string, run: () => Promise<T>): Promise<SettleResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, label, error: normalizeError(error) };
  }
}

export function normalizeError(error: unknown): NormalizedToolError {
  const status = getStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (status === 400) {
    return withStatus("invalid_request", message, status);
  }

  if (status === 401) {
    return {
      ...withStatus("unauthorized", message, status),
      remediation: "Ensure OWNER_KEYPAIR matches the job owner or an authorized request signer."
    };
  }

  if (status === 402) {
    const payload = getX402Payload(error);
    return {
      ...withStatus("payment_required", message, status),
      remediation:
        "Fund the x402 escrow (see molpha_agent_status) and retry, or use payment: \"subscription\" with an active subscription.",
      ...(payload !== undefined ? { details: payload } : {})
    };
  }

  if (status === 503 || isTimeout(error)) {
    return withStatus("round_timeout", message, status);
  }

  if (message.includes("OWNER_KEYPAIR") || message.includes("AGENT_KEYPAIR")) {
    return {
      code: "missing_config",
      message,
      remediation: "Set OWNER_KEYPAIR to the funded owner keypair JSON path in the MCP server env."
    };
  }

  if (
    message.includes("must be a valid Solana address") ||
    message.includes("Non-base58 character")
  ) {
    return {
      code: "invalid_config",
      message,
      remediation:
        "Check PRIVY_WALLET_ADDRESS / TURNKEY_WALLET_ADDRESS (and optional MOLPHA_X402_GATEWAY_PDA) in your MCP env. Use a real Solana devnet pubkey — not placeholders like <base58-solana-address>."
    };
  }

  if (message.includes("Subscription") || message.includes("subscription")) {
    return {
      code: "subscription_inactive",
      message,
      remediation: "Run the bootstrap CLI to subscribe, or use payment: \"x402\" for a self-funded round."
    };
  }

  if (message.includes("cap reached")) {
    return { code: "guardrail_exceeded", message };
  }

  if (message.includes('"jsonrpc"') && message.includes("Method not found")) {
    return {
      code: "invalid_config",
      message,
      remediation:
        "GATEWAY_ENDPOINTS is pointing at a Solana RPC URL, not a Molpha gateway. Set it to the Molpha gateway base URL (see README / npm run doctor) and keep SOLANA_RPC separate."
    };
  }

  if (message.includes("/v1/agent/execute") && message.includes("page not found")) {
    return {
      code: "invalid_config",
      message,
      remediation:
        "This gateway host exposes /v1/nodes but not signing routes. Use https://dev-gateway.molpha.io (run npm run doctor to verify)."
    };
  }

  if (message.includes("determinism") || message.includes("live-drifting")) {
    return { code: "determinism_rejected", message };
  }

  return withStatus("internal_error", message, status);
}

function withStatus(code: string, message: string, status: number | undefined): NormalizedToolError {
  return status === undefined ? { code, message } : { code, message, status };
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const response = record.response as Record<string, unknown> | undefined;
  const cause = record.cause as Record<string, unknown> | undefined;
  const status = record.status ?? record.statusCode ?? response?.status ?? cause?.status;

  return typeof status === "number" ? status : undefined;
}

function getX402Payload(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  return (error as Record<string, unknown>).x402;
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return code === "ETIMEDOUT" || code === "ECONNRESET" || message.includes("timeout");
}
