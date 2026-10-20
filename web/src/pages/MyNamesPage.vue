<script setup lang="ts">
import {wallet, askToConnect} from '../core/wallet'
import Inventory from '../components/Inventory.vue'
</script>

<template>
  <section class="shelf">
    <Inventory v-if="wallet.address" :address="wallet.address" :editable="true" />
    <div v-else class="py-14 text-center grid gap-3 justify-items-center">
      <p class="text-[15px]">Connect a wallet to see its names.</p>
      <button class="btn btn-plasma" @click="askToConnect()">Connect wallet</button>
    </div>
  </section>
</template>
