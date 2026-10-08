# Velum App

**Private, soulbound credentials on [Midnight](https://midnight.network): issue them, hold them,
and prove things about them in zero knowledge.**

This is the web app for [Velum](https://github.com/AdaSouls/velum). The Compact smart contract,
the indexer API and the deployment tooling live in [`AdaSouls/velum`](https://github.com/AdaSouls/velum).
Built by [AdaSouls](https://github.com/AdaSouls).

Unlike a POAP on a public chain, the chain never shows who holds a credential or links one person
across organizers, and holders can prove things about a credential without showing it:

- **A different pseudonym per organizer.** Two organizers can't tell they share an attendee.
- **Anonymous proofs.** "I hold a valid ticket for this event", without saying which one or which
  wallet.
- **Private data per credential.** The chain stores only a Merkle root; the values travel encrypted
  to the holder.
- **Range proofs.** "I'm at least 18" or "my credential is valid after today", without revealing
  the date.
- **Verification without a wallet.** Whoever receives a proof opens a link and sees it confirmed
  on-chain.
- **Validity and revocation.** Credentials can expire, and issuers can revoke them.

## What you can do

**Event categories:**

| Category | Who gets it | How | Private data |
|---|---|---|---|
| **Event** ("I was there") | Anyone | Claims it themselves | No |
| **Subscription** ("I'm a member") | Anyone | Claims it themselves | No |
| **Credential** ("I was certified") | One specific person | Issued by the organizer | Yes, per holder |

**Organizers:**
- Create events with a step-by-step wizard: capacity, deadline, validity period, taxonomy, and
  typed private fields (text, integer with range, date, list, identity document).
- Invite holders with a link or QR code, and issue credentials with each holder's private values.
- See their holders, revoke credentials, and ask holders questions about private data ("is one of…",
  "≥", "between", "at least N years ago").
- Tie a credential to the holder's identity document, so a verifier who checks the document can
  tell the credential is theirs (no answering with a friend's).
- Review holders' update requests (e.g. a new document number) and re-issue in one transaction.

**Holders:**
- Explore and claim events, and see all their credentials in one place.
- Prove ownership publicly or anonymously ("Anonymous among N holders", with a warning below 5).
- Answer an organizer's question about a private detail without revealing the value, together with
  an identity check when the credential carries a document.
- Ask the organizer to update a credential, encrypted so only the organizer can read it.
- Keep a receipt and a history of every proof, and share a public collection page.

**Verifiers:** `/app/verify` checks a proof from its link or hash, with no account and no wallet.
It shows what was proven, for which event, whether the credential is still valid or was revoked,
and until when.

**Identity and backup:** there are no passwords. Each wallet gets a random key in the browser,
which is also its recovery code. The private state is encrypted in the browser and backed up
automatically to private IPFS storage (Pinata), with a file download as well.

Wallets: [Lace](https://www.lace.io) or 1am, through Midnight's DApp connector.

## Running it

Requires Node.js 24, a Midnight wallet extension, and a proof server.

```bash
npm install
cp .env.example .env   # see the comments in the file
npm start              # http://localhost:3000
```

| Variable | What it is |
|---|---|
| `REACT_APP_MIDNIGHT_NETWORK_ID` | `undeployed` (local devnet) or `preprod`; must match the wallet and the contract |
| `REACT_APP_MIDNIGHT_CONTRACT_ADDRESS` | The deployed Velum contract |
| `REACT_APP_MIDNIGHT_INDEXER_API_URL` | The Velum indexer API (from `AdaSouls/velum`) |
| `REACT_APP_MIDNIGHT_INDEXER_GRAPHQL_URL` | Midnight's own indexer, used by `/app/verify` |
| `REACT_APP_MIDNIGHT_PROOF_SERVER_URL` | A local proof server (see `AdaSouls/velum` for the Docker setup) |
| `REACT_APP_IPFS_API_URL` | The IPFS proxy in `server/` |
| `REACT_APP_ADMIN_WALLET_ADDRESSES` | Wallets allowed on `/app/admin/deploy` (UI gating only) |
| `REACT_APP_MIDNIGHT_ZK_CONFIG_PATH` | Optional. Where the ZK keys are served from (default `/midnight/poap`). Only for a local devnet running an older contract; never set on Vercel |

**IPFS proxy (`server/`):** a small Express server that keeps the Pinata key out of the browser
bundle. It handles event metadata, encrypted backups, encrypted credential delivery, disclosure
request questions and encrypted credential update requests (`/api/credential-update`).

```bash
cd server
npm install
cp .env.example .env   # PINATA_JWT (upload-only scope), PORT, CORS_ALLOWED_ORIGIN
npm start
```

**Contract artifacts:** the compiled contract and its ZK keys come from `AdaSouls/velum`. After the
contract is recompiled, sync them:

```bash
POAP_MIDNIGHT_DIR=../velum ./scripts/sync-midnight-contract.sh
```

### Other commands

```bash
npm run build          # production build in build/
npm test               # Jest, watch mode
CI=true npm test       # single run
```

## Project layout

```
src/
├── midnight/       # Midnight integration: wallet, providers, contract calls, proofs, backups
├── jsx/
│   ├── pages/      # route-level pages (router.jsx)
│   ├── drawer/     # slide-out forms (create event, mint, connect wallet)
│   └── contexts/   # app state and roles
├── services/       # IPFS client
├── shims/          # CommonJS shims for Midnight packages (see craco.config.js)
└── __tests__/
server/             # IPFS proxy
public/midnight/    # ZK keys and circuits, served to the prover
```

`craco.config.js` adds WebAssembly support, a `Buffer` polyfill, and aliases that make Midnight's
packages build under Create React App. Read its comments before changing it.

## Known limits

- A proof can be repeated: it shows you hold the credential, but it isn't single-use.
- Anonymity depends on the size of the event; the app warns below 5 holders.
- Validity is computed by the app, not the contract.
- Every proof is a transaction: it costs DUST and takes as long as the network does.
- Without the recovery code, a lost browser means you can no longer prove your credentials are
  yours (they still exist on-chain).

## License

MIT. See [LICENSE](LICENSE).
