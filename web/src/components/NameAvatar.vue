<script setup lang="ts">
// A name's avatar record, drawn: an image URL (https, ipfs, data), or an NFT
// by ENSIP-12's eip155:<chain>/erc721:<contract>/<id>. An NFT avatar is shown
// only while the name's own address holds that NFT, as ENSIP-12 asks, so
// nobody can wear someone else's.
import {ref, watch} from 'vue'
import {parseAbi, type Address} from 'viem'
import {endpoint} from '../core/endpoint'
import {publicClient} from '@zvm/web/evm'
import Avatar from './Avatar.vue'

const props = withDefaults(defineProps<{record?: string; owner?: string | null; seed: string; size?: number}>(), {record: '', owner: null, size: 56})

const src = ref('')

const gateway = (u: string) => (u.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${u.slice(7)}` : u)
const safe = (u: string) => /^(https:|data:image\/)/.test(u)

async function resolve(rec: string): Promise<string> {
  if (!rec) return ''
  const nft = /^eip155:(\d+)\/erc721:(0x[0-9a-fA-F]{40})\/(\d+)$/.exec(rec)
  if (nft) {
    if (Number(nft[1]) !== endpoint.chainId || !props.owner) return ''
    const client = publicClient(endpoint.chainId!)
    const abi = parseAbi(['function ownerOf(uint256) view returns (address)', 'function tokenURI(uint256) view returns (string)'])
    const [holder, uri] = await Promise.all([
      client.readContract({address: nft[2] as Address, abi, functionName: 'ownerOf', args: [BigInt(nft[3])]}),
      client.readContract({address: nft[2] as Address, abi, functionName: 'tokenURI', args: [BigInt(nft[3])]}),
    ])
    if (holder.toLowerCase() !== props.owner.toLowerCase()) return ''
    const meta = uri.startsWith('data:application/json;base64,')
      ? JSON.parse(atob(uri.split(',')[1]))
      : await (await fetch(gateway(uri))).json()
    const image = gateway(meta.image ?? meta.image_url ?? '')
    return safe(image) ? image : ''
  }
  const url = gateway(rec)
  return safe(url) ? url : ''
}

watch(
  () => [props.record, props.owner, endpoint.chainId],
  async () => {
    src.value = await resolve(props.record).catch(() => '')
  },
  {immediate: true},
)
</script>

<template>
  <img v-if="src" :src="src" alt="" class="rounded-full object-cover bg-sunk shrink-0" :style="{width: `${size}px`, height: `${size}px`}" @error="src = ''" />
  <Avatar v-else :seed="seed" :size="size" />
</template>
