import { normalizeError } from "./errors.js";

export interface TextToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function jsonResult(value: unknown): TextToolResult {
  return {
    content: [
      {
        type: "text",
        text: stringifyToolJson(value)
      }
    ]
  };
}

export function errorResult(error: unknown): TextToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: stringifyToolJson(normalizeError(error))
      }
    ]
  };
}

export function toolHandler<TArgs>(
  handler: (args: TArgs) => Promise<unknown> | unknown
): (args: TArgs) => Promise<TextToolResult> {
  return async (args) => {
    try {
      return jsonResult(await handler(args));
    } catch (error) {
      return errorResult(error);
    }
  };
}

export function stringifyToolJson(value: unknown): string {
  return JSON.stringify(toJsonSafe(value), null, 2) ?? "null";
}

function toJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value !== "object") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return bytesToHex(value);
  }

  if (isPublicKeyLike(value)) {
    return value.toBase58();
  }

  if (isBnLike(value)) {
    return (value as { toString: (radix?: number) => string }).toString(10);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.map((item) => toJsonSafe(item, seen));
    seen.delete(value);
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = toJsonSafe(item, seen);
  }

  seen.delete(value);
  return out;
}

function isPublicKeyLike(value: object): value is { toBase58: () => string } {
  return value.constructor.name === "PublicKey" && "toBase58" in value && typeof value.toBase58 === "function";
}

function isBnLike(value: object): boolean {
  return (
    value.constructor.name === "BN" &&
    "toString" in value &&
    typeof value.toString === "function" &&
    "words" in value
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
