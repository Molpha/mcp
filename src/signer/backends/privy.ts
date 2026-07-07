import { createRequire } from "node:module";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { MolphaSigner } from "../types.js";

const require = createRequire(import.meta.url);

interface PrivyWalletApi {
  solana: {
    signTransaction(args: {
      walletId: string;
      transaction: Transaction | VersionedTransaction;
    }): Promise<{ signedTransaction: Transaction | VersionedTransaction }>;
    signMessage(args: { walletId: string; message: Uint8Array }): Promise<{ signature: Uint8Array }>;
  };
  getWallet(args: { id: string }): Promise<{ id: string; address: string }>;
}
interface PrivyClientLike {
  walletApi: PrivyWalletApi;
}

export interface PrivySignerConfig {
  appId: string;
  appSecret: string;
  walletId: string;
  address: string;
}

export class PrivySigner implements MolphaSigner {
  readonly publicKey: PublicKey;
  private readonly walletId: string;
  private readonly privy: PrivyClientLike;

  constructor(config: PrivySignerConfig) {
    this.publicKey = new PublicKey(config.address);
    this.walletId = config.walletId;
   
    let PrivyClient: new (appId: string, appSecret: string) => PrivyClientLike;
    try {
      ({ PrivyClient } = require("@privy-io/server-auth") as {
        PrivyClient: new (appId: string, appSecret: string) => PrivyClientLike;
      });
    } catch (error) {
      throw new Error(
        "@privy-io/server-auth is not installed. Run `npm install @privy-io/server-auth` to use SIGNER_BACKEND=keychain with KEYCHAIN_BACKEND=privy.",
        { cause: error }
      );
    }
    this.privy = new PrivyClient(config.appId, config.appSecret);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.privy.walletApi.getWallet({ id: this.walletId });
      return true;
    } catch {
      return false;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const { signedTransaction } = await this.privy.walletApi.solana.signTransaction({
      walletId: this.walletId,
      transaction: tx,
    });

    return signedTransaction as T;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { signature } = await this.privy.walletApi.solana.signMessage({
      walletId: this.walletId,
      message,
    });
    return signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  }
}
