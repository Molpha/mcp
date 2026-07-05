import { loadOwnerKeypair } from "../config.js";
import type { MolphaConfig } from "../config.js";
import { MemorySigner } from "./backends/memory.js";

export function createSigner(config: MolphaConfig): MemorySigner {
  return new MemorySigner(loadOwnerKeypair(config));
}
