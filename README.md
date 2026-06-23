# Molpha MCP

MCP server for Molpha oracle runtime tools, using `@molpha-oracle/sdk@0.4.0`.

**v1 (Model A):** self-hosted owner-key runtime. The same `OWNER_KEYPAIR` signs on-chain job creation/execute and gateway `authSig` requests. Subscription bootstrap (`subscribe`/`extend`, USDC debit) stays in the separate CLI.

## Tools

- `molpha_get_capabilities` — discovery (registry, nodes, chains, gateways)
- `molpha_describe_job` — on-chain job + gateway config
- `molpha_create_job` — owner-signed job registration (requires active subscription)
- `molpha_fetch_verified` — signed artifact + per-chain verifier args
- `molpha_get_latest` — read on-chain feed
- `molpha_verify` — Solana simulate verify or EVM/Starknet verifier args
- `molpha_execute` — Solana `submit_data_update` only

Delegates are deferred to v2/A2.

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm run dev
```

`OWNER_KEYPAIR` must point to the funded owner keypair JSON. Bootstrap the subscription once before creating jobs:

```bash
npm run provision -- subscribe --max-price-usdc 1000000
```

## MCP config

After `npm run build`, point your MCP client at:

```json
{
  "mcpServers": {
    "molpha": {
      "command": "node",
      "args": ["/absolute/path/to/molpha-mcp/dist/src/server.js"],
      "env": {
        "SOLANA_RPC": "https://api.devnet.solana.com",
        "OWNER_KEYPAIR": "/absolute/path/to/owner.json",
        "MOLPHA_EVM_NETWORKS": "evm-sepolia",
        "MOLPHA_STARKNET_NETWORKS": "starknet-sepolia",
        "MOLPHA_MAX_JOBS_PER_DAY": "10",
        "MOLPHA_MAX_EXECUTES_PER_DAY": "100"
      }
    }
  }
}
```

## Bootstrap CLI

USDC-debit actions only — not exposed in the MCP runtime:

```bash
npm run provision -- subscribe --plan Basic --max-price-usdc 1000000 --dry-run
npm run provision -- extend --max-price-usdc 1000000
```

## Guardrails

Server-side caps on write tools (`molpha_create_job`, `molpha_execute`):

- `MOLPHA_MAX_JOBS_PER_DAY` (default 10)
- `MOLPHA_MAX_EXECUTES_PER_DAY` (default 100)
- `MOLPHA_DRY_RUN=true` — preview writes without sending txs

## Release checklist

- [ ] `OWNER_KEYPAIR` funded with SOL (fees) and active USDC subscription (bootstrap CLI)
- [ ] Tool schemas match [docs/Molpha MCP Server.md](docs/Molpha%20MCP%20Server.md)
- [ ] `npm run build && npm test` pass
- [ ] MCP client env uses absolute paths for `OWNER_KEYPAIR`
