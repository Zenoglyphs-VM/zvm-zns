// What this app tells the shared modules about itself. Imported first, before
// anything that reads a number or builds a client.

import {configure} from '@zvm/web/config'
import {rpcUrl} from './endpoint'
import {chainName} from './chains'

configure({
  // A dash for "not known", the way the explorer prints it.
  empty: '-',
  rpcUrl,
  // The build uses relative paths, so the page's own address is where it lives.
  appUrl: () => (typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`),
  chainName,
})
