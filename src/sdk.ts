import * as MolphaSdkModule from "@molpha-oracle/sdk";

export const MolphaSdk = MolphaSdkModule as Record<string, unknown>;

export function getSdkExport<T = unknown>(name: string): T | undefined {
  return MolphaSdk[name] as T | undefined;
}

export function requireSdkExport<T = unknown>(name: string): T {
  const value = getSdkExport<T>(name);
  if (value === undefined || value === null) {
    throw new Error(`@molpha-oracle/sdk does not export ${name}`);
  }
  return value;
}
