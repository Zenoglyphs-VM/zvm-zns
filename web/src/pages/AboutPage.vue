<script setup lang="ts">
import {computed} from 'vue'
import {endpoint} from '../core/endpoint'
import {deploymentFor} from '../core/deployment'
import {explorer, karumCollection} from '../core/links'
import {short, znn} from '../core/format'
import Icon from '../components/Icon.vue'

const d = computed(() => deploymentFor(endpoint.chainId))
const premium = computed(() => (d.value?.terms ? znn(BigInt(d.value.terms.startPremium), 0) : '100,000'))
const roles: Record<string, string> = {
  ENSRegistry: 'Every name, its manager and its resolver',
  ZNSRegistrar: 'The .znn tokens (ERC-721), and their cards',
  ZNSController: 'Registration and renewal, commit-reveal; burns the rent',
  ExponentialPremiumPriceOracle: 'The price: rent by length, the falling premium',
  ZNSPriceFeed: 'The rate the oracle converts with (1:1 today)',
  PublicResolver: 'Records: address, text, and the rest',
  ReverseRegistrar: 'Primary names (addr.reverse)',
  UniversalResolver: 'One-call lookups, as viem and ENS tools make them',
  StaticBulkRenewal: 'Renewing many names in one transaction',
  GatewayProvider: 'The universal resolver\'s gateway list (unused: all records are on chain)',
}
</script>

<template>
  <div class="grid gap-5 max-w-[860px] mx-auto">
    <section class="shelf grid gap-3 text-[14.5px] leading-relaxed">
      <h1 class="text-[24px] font-semibold tracking-[-0.02em]">How ZNS works</h1>
      <p>
        ZNS is ENS on the ZVM. The contracts are ENS's own, unchanged, apart from a controller for <b>.znn</b> and a registrar
        that keeps each name's label and draws its card on chain. Anything that speaks ENS reads it: viem's
        <code class="mono text-[13px]">getEnsName</code> and <code class="mono text-[13px]">getEnsAddress</code> work against its universal resolver.
      </p>
    </section>

    <section class="shelf grid gap-3 text-[14px]">
      <h2 class="text-[16px] font-semibold">The rules</h2>
      <ul class="grid gap-2 list-none">
        <li class="flex gap-3"><Icon name="coins" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>Rent, by length.</b> 128 ZNN a year for 3 characters, 32 for 4, 1 for 5 or more: ENS's ratios. At least 28 days at a time.</span></li>
        <li class="flex gap-3"><Icon name="hourglass" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>A falling premium.</b> A name returning from expiry costs a premium that starts at {{ premium }} ZNN and halves every day, gone after 21. Names of up to six characters opened the same way at launch.</span></li>
        <li class="flex gap-3"><Icon name="clock" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>90 days of grace.</b> An expired name stops resolving to an owner, but only its holder can renew it for 90 days.</span></li>
        <li class="flex gap-3"><Icon name="eye" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>Commit, then reveal.</b> Registering is two transactions at least a minute apart, so a relayer that sees the first cannot take the name.</span></li>
        <li class="flex gap-3"><Icon name="at" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>a-z, 0-9 and "-".</b> 3 to 63 characters, checked by the contract, so no look-alike letters and no name that tools cannot resolve.</span></li>
        <li class="flex gap-3"><Icon name="star" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>Primary names check both ways.</b> An address shows a name only while that name points back at it.</span></li>
        <li class="flex gap-3"><Icon name="tag" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>Names are NFTs.</b> Selling one on <a v-if="karumCollection()" class="link" :href="karumCollection()!" target="_blank" rel="noopener">Karum</a><span v-else>Karum</span> hands the buyer its records too; they point it at themselves.</span></li>
        <li class="flex gap-3"><Icon name="gift" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>Anyone may renew any name.</b></span></li>
        <li class="flex gap-3"><Icon name="flame" :size="16" class="mt-0.5 shrink-0 text-dim" /><span><b>Rent is burned.</b> Every ZNN paid for a name goes to <span class="mono text-[12.5px]">0x…dEaD</span>, the ZVM's burn address, in the same transaction. Nobody collects it.</span></li>
      </ul>
    </section>

    <section v-if="d" class="shelf grid gap-3">
      <h2 class="text-[16px] font-semibold">Contracts <span class="text-dim font-normal text-[13px]">chain {{ d.chainId }}, all verified</span></h2>
      <table class="w-full text-[13px]">
        <tbody>
          <tr v-for="(addr, name) in d.contracts" :key="name">
            <td class="td font-medium whitespace-nowrap">{{ name }}</td>
            <td class="td text-dim hidden md:table-cell">{{ roles[name] }}</td>
            <td class="td text-right">
              <a v-if="explorer(`/address/${addr}`)" class="link mono" :href="explorer(`/address/${addr}`)!" target="_blank" rel="noopener">{{ short(addr, 8, 6) }}</a>
              <span v-else class="mono">{{ short(addr, 8, 6) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
