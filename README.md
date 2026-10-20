# zvm-zns

ENS on the ZVM: `.znn` names that point at an address, and addresses that name
themselves back. The contracts are ENS's own, compiled from
`@ensdomains/ens-contracts` 1.7.0, plus a registrar subclass, a controller fork
(each change marked `ZNS:`) and a 40-line price feed. Rent is burned.

Every address is in `deployments/zvm.json`, which the deploy writes and the
page bundles at build time; kept out of git, as every devnet deploys its own.

- `contracts/`: ZNS's contracts (`src/`), ENS's sources (`vendor/`), and the
  scripts that vendor, build, test and deploy them
- `web/`: the page, static, reading the contracts and their logs directly

The page compiles `@zvm/web` from the [zvm-core](https://github.com/Zenoglyphs-VM/zvm-core)
submodule, so clone with `--recurse-submodules`.

```sh
cp .env.example .env
cd contracts && npm install
npm run build      # out/*.json and web/src/abi.ts
npm run test       # on a local anvil; the command is in the file's header

cd ../web && npm install
npm run dev        # http://localhost:47800/
npm run verify     # registers for real on chain 69, in headless Chrome
```

No node is built in. `VITE_ZVM_NODE` names the node the page reads and
`VITE_GATEWAY` where the other apps are; the build stops without them, and the
scripts read `ZVM_RPC`. `.env.example` has
a local [zvm-devnet](https://github.com/Zenoglyphs-VM/zvm-devnet)'s.

## Deploy

Every push to `main` publishes `web/dist` to GitHub Pages (Settings, Pages,
Source: GitHub Actions), built with the organisation's `ZVM_NODE` and `ZVM_GATEWAY`
Actions variables. The build is relative with hash routes, so it
serves unchanged from a project path, a domain's root or a gateway path.

MIT licence; ENS's vendored sources are noted in [NOTICE.md](NOTICE.md). The full guide, with how it works and why: [docs/GUIDE.md](docs/GUIDE.md).
