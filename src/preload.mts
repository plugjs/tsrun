import { createRequire, registerHooks } from 'node:module'

import { load, resolve } from './loader-module.mjs'

process.setSourceMapsEnabled(true)
registerHooks({ resolve, load })
createRequire(import.meta.url)('./loader-commonjs.cjs')
