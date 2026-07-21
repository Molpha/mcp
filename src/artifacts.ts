/** Shape a gateway DataUpdateResult into the spec-friendly signed artifact. */

export interface SignedDataUpdate {
  feedId: string;
  registryVersion: number;
  signaturesRequired: number;
  value: string;
  valuePacked?: string;
  canonicalTimestamp: number;
}

export interface SignedSignature {
  signature: string;
  commitment: string;
  signersBitmap: string;
}

export interface DataUpdateArtifact {
  value: string;
  fresh: boolean;
  dataUpdate: SignedDataUpdate;
  signature: SignedSignature;
}

export function toDataUpdateArtifact(result: Record<string, unknown>): DataUpdateArtifact {
  return {
    value: String(result.value ?? ""),
    fresh: Boolean(result.fresh ?? true),
    dataUpdate: {
      feedId: String(result.feedId ?? ""),
      registryVersion: Number(result.registryVersion ?? 0),
      signaturesRequired: Number(result.signaturesRequired ?? 0),
      value: String(result.value ?? ""),
      ...(result.valuePacked !== undefined
        ? { valuePacked: String(result.valuePacked) }
        : {}),
      canonicalTimestamp: Number(result.timestamp ?? 0)
    },
    signature: {
      signature: String(result.s ?? ""),
      commitment: String(result.commitmentAddr ?? ""),
      signersBitmap: String(result.signersBitmap ?? "")
    }
  };
}
