import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { Wallet } from "@coral-xyz/anchor";
import type { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { MolphaSigner } from "../types.js";

export class MemorySigner implements MolphaSigner {
  readonly publicKey: PublicKey;
  readonly keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    return new Wallet(this.keypair).signTransaction(tx);
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return new Wallet(this.keypair).signAllTransactions(txs);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    // Ed25519 PKCS#8 DER: wrap the 32-byte seed from the 64-byte Solana secretKey
    const seed = this.keypair.secretKey.subarray(0, 32);
    const header = Buffer.from("302e020100300506032b657004220420", "hex");
    const key = createPrivateKey({ key: Buffer.concat([header, seed]), format: "der", type: "pkcs8" });
    return new Uint8Array(cryptoSign(null, message, key));
  }
}
