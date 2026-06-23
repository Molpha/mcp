export interface NormalizedToolError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  remediation?: string;
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
    return {
      ...withStatus("subscription_inactive", message, status),
      remediation: "Bootstrap or extend the subscription via `npm run provision -- subscribe` before requesting data."
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

  if (message.includes("Subscription") || message.includes("subscription")) {
    return {
      code: "subscription_inactive",
      message,
      remediation: "Run the bootstrap CLI to subscribe before creating jobs or requesting signed data."
    };
  }

  if (message.includes("cap reached")) {
    return { code: "guardrail_exceeded", message };
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

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return code === "ETIMEDOUT" || code === "ECONNRESET" || message.includes("timeout");
}
