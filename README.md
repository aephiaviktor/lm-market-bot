# LM Market Bot

LM Market Bot is an Electron desktop app for automating selected Star Atlas Local Marketplace orders.

This repository was initialized from the GM Market Bot codebase as a scaffold, but it is a separate project. The local-market flow will diverge from Galactic Marketplace automation because sell orders must first mint starbase-specific certificate tokens from SAGE cargo.

## Current Status

Initial scaffold:

- Electron desktop UI, settings storage, updater shell, wallet loading, Aephia token validation, RPC rate limiting, and GM order-management code copied from GM Market Bot.
- Project identity renamed to LM Market Bot.
- Version reset to `0.1.0`.
- No live app folder has been created or updated.

The next implementation slice is local-market specific:

- Add faction and player-profile settings.
- Add per-rule starbase selection.
- Add static mappings for starbase public keys, faction ownership, asset mints, and starbase certificate mints.
- Resolve profile-specific starbase player, cargo pod, cargo token account, and certificate token account.
- Validate lancer-wallet profile permissions, especially SAGE `addRemoveCargo`.
- Implement sell-only MVP: mint certificate, then create a marketplace sell order.

## Security Model

The app stores secrets in local settings, not in the repository.

Sensitive values include:

- Aephia API key
- RPC URL
- hot/lancer wallet secret
- player profile and wallet configuration

Never commit local settings, runtime logs, wallet secrets, or `.env` files.

The repository intentionally ignores:

- `node_modules/`
- `dist/`
- `analysis/`
- `.env`
- `.env.*`
- logs and local editor/OS files

## Requirements

- Node.js
- npm
- A Solana RPC endpoint
- A hot/lancer wallet secret with the required player-profile permissions
- A valid Aephia API token

## Install

```bash
npm install
```

## Run The Desktop App

```bash
npm run start:electron
```

For development, this command builds the TypeScript source first and then starts Electron.

## Build

```bash
npm run build
```

## Typecheck

```bash
npm run typecheck
```

## Runtime Data

Runtime files are written under `analysis/` and are intentionally not committed.

These files may include:

- bot state
- order logs
- Electron stderr logs

Keep this folder local.

## Notes

This bot can place real marketplace transactions. Use a dedicated hot/lancer wallet and configure rules carefully.
