# Molpha MCP — Build & Claude Desktop Setup

## 1. Build the server

From the repo root:

```bash
npm install
npm run build
```

This compiles TypeScript (`tsc -p tsconfig.json`) into `dist/`. The MCP
server entry point is `dist/src/server.js` — that's the file Claude Desktop
will launch.

> **Warning:** Restart Claude Desktop after any config or code change. The
> MCP server is a long-running process that only reads its env config and
> compiled code once, at startup — editing `claude_desktop_config.json` or
> re-running `npm run build` alone does not affect an already-running
> server.

**Optional sanity check** (skip this if `npm run build` already exited with
no `tsc` errors — that alone means it built cleanly):

```bash
ls dist/src/server.js
```

Don't run `node dist/src/server.js` directly to "test" it — it's a stdio MCP
server with no `--help` or standalone mode. It will just sit there waiting
for JSON-RPC input on stdin and appear to hang (that's normal; Ctrl+C to
exit). The real confirmation that it works is launching it through Claude
Desktop (step 2 below) and seeing the `molpha` tools appear.

---

## 2. Add it to Claude Desktop

Edit `claude_desktop_config.json` (Claude Desktop → Settings, or directly on
disk) and add a `molpha` entry under `mcpServers`. The `command`/`args` are
the same in all three cases below — only the `env` block changes depending on
which wallet backend you want the server to sign with.

Replace `/absolute/path/to/molpha-mcp` with the real path to this repo.

### Common env vars (all backends)

| Var | Default | Purpose |
|---|---|---|
| `SOLANA_RPC` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `GATEWAY_ENDPOINTS` | SDK default gateway | Comma-separated gateway URL(s) |
| `PROGRAM_ID` | SDK default | Molpha on-chain program override |
| `MOLPHA_EVM_NETWORKS` | `evm-sepolia` | Comma-separated EVM verifier networks |
| `MOLPHA_STARKNET_NETWORKS` | `starknet-sepolia` | Comma-separated Starknet verifier networks |
| `MOLPHA_MAX_JOBS_PER_DAY` | `10` | Guardrail cap on `molpha_create_job` |
| `MOLPHA_MAX_EXECUTES_PER_DAY` | `100` | Guardrail cap on `molpha_execute` |
| `MOLPHA_DRY_RUN` | `false` | Force all writes to preview-only |

---

### Case A — Memory signer (local keypair)

Simplest option, good for local dev/devnet. The server holds a raw Solana
keypair file in its own process memory and signs everything with it
directly. This is also the default if `SIGNER_BACKEND` is unset.

```json
{
  "mcpServers": {
    "molpha": {
      "command": "node",
      "args": ["/absolute/path/to/molpha-mcp/dist/src/server.js"],
      "env": {
        "SIGNER_BACKEND": "memory",
        "OWNER_KEYPAIR": "/absolute/path/to/owner-keypair.json",
        "SOLANA_RPC": "https://api.devnet.solana.com"
      }
    }
  }
}
```

`OWNER_KEYPAIR` must point to a JSON keypair file (array of secret-key
bytes) funded with devnet SOL and, once subscribed, USDC. Bootstrap the
subscription once via:

```bash
SIGNER_BACKEND=memory OWNER_KEYPAIR=/absolute/path/to/owner-keypair.json \
npm run provision -- subscribe --max-price-usdc <amount>
```

---

### Case B — Privy signer (custodial wallet)

The server never touches a raw private key — signing requests go out to
Privy's API for a server wallet you've created in the Privy dashboard.

```json
{
  "mcpServers": {
    "molpha": {
      "command": "node",
      "args": ["/absolute/path/to/molpha-mcp/dist/src/server.js"],
      "env": {
        "SIGNER_BACKEND": "keychain",
        "KEYCHAIN_BACKEND": "privy",
        "PRIVY_APP_ID": "<your Privy app id>",
        "PRIVY_APP_SECRET": "<your Privy app secret>",
        "PRIVY_WALLET_ID": "<your Privy server wallet id>",
        "PRIVY_WALLET_ADDRESS": "<base58 Solana address of that wallet>",
        "SOLANA_RPC": "https://api.devnet.solana.com"
      }
    }
  }
}
```

Requires `@privy-io/server-auth` installed (`npm install
@privy-io/server-auth` — already a project dependency after this session's
fixes). Fund `PRIVY_WALLET_ADDRESS` with devnet SOL + USDC, then bootstrap
the subscription with the same env vars:

```bash
SIGNER_BACKEND=keychain KEYCHAIN_BACKEND=privy \
PRIVY_APP_ID=... PRIVY_APP_SECRET=... PRIVY_WALLET_ID=... PRIVY_WALLET_ADDRESS=... \
npm run provision -- subscribe --max-price-usdc <amount>
```

---

### Case C — Turnkey signer (custodial wallet)

Same idea as Privy, backed by Turnkey instead — signing requests go to
Turnkey's API for a wallet under your Turnkey organization.

```json
{
  "mcpServers": {
    "molpha": {
      "command": "node",
      "args": ["/absolute/path/to/molpha-mcp/dist/src/server.js"],
      "env": {
        "SIGNER_BACKEND": "keychain",
        "KEYCHAIN_BACKEND": "turnkey",
        "TURNKEY_API_PUBLIC_KEY": "<your Turnkey API public key>",
        "TURNKEY_API_PRIVATE_KEY": "<your Turnkey API private key>",
        "TURNKEY_ORGANIZATION_ID": "<your Turnkey organization id>",
        "TURNKEY_WALLET_ADDRESS": "<base58 Solana address of that wallet>",
        "SOLANA_RPC": "https://api.devnet.solana.com"
      }
    }
  }
}
```

Requires `@turnkey/sdk-server` and `@turnkey/solana` installed (`npm install
@turnkey/sdk-server @turnkey/solana`). Double-check `TURNKEY_ORGANIZATION_ID`
against your Turnkey dashboard exactly — a mismatched org ID fails with a
`Turnkey error 5: no organization found` error. Fund
`TURNKEY_WALLET_ADDRESS` with devnet SOL + USDC, then bootstrap:

```bash
SIGNER_BACKEND=keychain KEYCHAIN_BACKEND=turnkey \
TURNKEY_API_PUBLIC_KEY=... TURNKEY_API_PRIVATE_KEY=... TURNKEY_ORGANIZATION_ID=... TURNKEY_WALLET_ADDRESS=... \
npm run provision -- subscribe --max-price-usdc <amount>
```

---

## Notes

- **Job ownership is wallet-specific.** A job created under one backend's
  wallet can only be fetched/executed while that same backend is active —
  switching `SIGNER_BACKEND`/`KEYCHAIN_BACKEND` changes which jobs the server
  can touch, not just how it signs.
- **`--max-price-usdc` is in raw USDC base units** (6 decimals), not dollars
  — e.g. `20000000` = 20 USDC. Check the actual plan price by attempting a
  subscribe with a low cap first; the error message reports the real
  on-chain price if your cap is too low.

