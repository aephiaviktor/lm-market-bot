# Local Market Implementation Plan

## Static Data Inputs

The first local-market mapping layer should be generated from the query data Viktor provided:

- `starbaseName -> starbasePublicKey`
- `starbaseName -> faction`
- `assetSymbol -> rawAssetMint`
- `starbaseName + assetSymbol/rawAssetMint -> certificateMint`

Keep this data structured in source-controlled TypeScript or JSON so rule validation, UI filtering, and transaction builders use the same source of truth.

## Settings

Add explicit settings before enabling live local-market order placement:

- `Faction`: `MUD`, `ONI`, or `USTUR`
- `Player Profile`: profile public key
- `Hot/Lancer Wallet Secret`: signer with profile permissions
- RPC and Aephia settings inherited from the GM Market Bot scaffold

The player profile should be explicit in v1. Auto-discovery can be added later as a helper, but silent profile selection is risky because one wallet can be authorized on multiple profiles.

## Startup Validation

Before any transaction sending, validate:

- selected profile exists
- selected hot/lancer wallet is authorized on that profile
- selected wallet has SAGE `addRemoveCargo`
- every rule starbase belongs to the configured faction
- every rule asset has a raw mint and starbase certificate mint
- starbase player and cargo pod resolve for the configured profile and starbase
- cargo token account and certificate token account can be derived or created as needed

## Sell MVP Flow

1. Resolve rule asset, starbase, profile, starbase player, cargo pod, and token accounts.
2. Simulate/build SAGE `mintCertificate`.
3. Send `mintCertificate` only after validation succeeds.
4. Create the marketplace sell order for the resulting certificate token.
5. Track open orders and balances using the certificate mint for local-market sell orders.

## Fixture

Use Viktor's sample transaction as a resolver/account-ordering fixture:

- Transaction: `3gJQHgLjKku7SMEahtKAydMvU4XXnN2EgfibTb6HuTJQbasZSysjdfpUnzSTWAo6TcPgyguMuS6yswFEzny6JZHv`
- Wallet: `HHDt8e4CgnujbAcnG5USS5P1dfcr3ZUc2rB1KyBrW8TF`
- Player profile: `4yMpTZKkug7cgTPQERDBZ35qo4pUV6KANN1RZVyszdYZ`
- Starbase mint: `2ugE9KwRKjSyMMT5jRgDvcmoHUZPuWG5KsphFeD9zrUR` (`MRZ_22`)
