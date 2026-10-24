# Isolated contract behavior

From the repository root, with Node 22 or later:

```sh
npm ci --ignore-scripts --prefix contracts/test
npm --prefix contracts run test:isolated
```

The separately locked toolchain compiles the current ZNS and vendored ENS
sources with solc 0.8.26, Paris and one million optimizer runs. The build and
tests share the same source collector and compiler settings. Tests fail when
dependencies are missing, compilation fails, or any of the ten saved creation
artifacts, the complete saved compiler input or the frontend ABI drifts. No
saved application bytecode is executed by the fixture.

The suite deploys and wires all ten actual contracts in an empty EthereumJS
Paris EVM. It checks commit-reveal and exact age boundaries, label rules,
pricing and premium decay, burn/refund accounting and complete-state rollback,
resolver records and viem ENS actions, token/registry transfers, inline
metadata, expiry/grace/re-registration and renewal. Controlled recipients
exercise failed refunds and later recovery; a Paris-only force-send fixture
exercises the permissionless burn of an unexpected controller balance.

The ENS client uses an in-process adapter restricted to static calls. External
RPC, HTTP/CCIP gateways, wallets, keys, signing and real funds are not used.
Balances, addresses, time and block context are explicitly synthetic. These
message frames do not qualify canonical transactions, intrinsic gas or fees,
Prague/Cancun/ZVM behavior, real deployments, browser commit/reveal recovery,
external gateways or production readiness.

The original `npm test` integration script remains separate. It requires an
explicit local Anvil RPC; it is not invoked by this suite. CI runs the isolated
suite and independently runs the real build, then refuses changes in tracked
artifacts or ABI. No vendor refresh or Solidity dependency upgrade is needed.
