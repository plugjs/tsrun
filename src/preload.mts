import { createRequire, register } from 'node:module'

process.setSourceMapsEnabled(true)
register('./loader-module.mjs', import.meta.url)
createRequire(import.meta.url)('./loader-commonjs.cjs')
