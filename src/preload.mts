import { createRequire, register } from 'node:module'

register('./loader-module.mjs', import.meta.url)
createRequire(import.meta.url)('./loader-commonjs.cjs')
