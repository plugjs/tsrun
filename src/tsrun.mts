#!/usr/bin/env node
/* eslint-disable no-console */

import _os from 'node:os'
import _path from 'node:path'
import _repl from 'node:repl'
import _module from 'node:module'

import _yargs from 'yargs-parser'

import { $blu, $gry, $rst, $und, $wht, main } from './cli.mjs'

/** Version injected by esbuild */
declare const __version: string

/** Our minimalistic help */
function _help(): void {
  console.log(`${$blu}${$und}Usage:${$rst}

  ${$wht}tsrun${$rst} ${$gry}[${$rst}--options${$gry}] script.ts [...${$rst}script args${$gry}]${$rst}

  ${$blu}${$und}Options:${$rst}

      ${$wht}-h --help     ${$rst}  Help! You're reading it now!
      ${$wht}-v --version  ${$rst}  Version! This one: ${__version}!
      ${$wht}-e --eval     ${$rst}  Evaluate the script
      ${$wht}-p --print    ${$rst}  Evaluate the script and print the result
      ${$wht}   --force-esm${$rst}  Force transpilation of ".ts" files to EcmaScript modules
      ${$wht}   --force-cjs${$rst}  Force transpilation of ".ts" files to CommonJS modules

  ${$blu}${$und}Description:${$rst}

      ${$wht}tsrun${$rst} is a minimalistic TypeScript loader, using "esbuild" to transpile TS
      code to JavaScript, and running it. Being extremely un-sofisticated, it's
      not meant to to be in any way a replacement for more complete alternatives
      like "ts-node".
`)

  process.exitCode = 1
}

/** Process the command line */
main(import.meta.url, (args: string[]): void | Promise<void> => {
  let _script: string | undefined
  let _scriptArgs: string[] = []
  let _print: boolean = false
  let _eval: boolean = false

  /* Yargs-parse our arguments */
  const parsed = _yargs(args, {
    configuration: {
      'camel-case-expansion': false,
      'strip-aliased': true,
      'strip-dashed': true,
    },

    alias: {
      'version': [ 'v' ],
      'help': [ 'h' ],
      'eval': [ 'e' ],
      'print': [ 'p' ],
    },

    boolean: [ 'help', 'eval', 'print', 'force-esm', 'version', 'force-cjs' ],
  })

  // Parse options, leaving script and scriptArgs with our code to run
  for (const [ key, value ] of Object.entries(parsed)) {
    switch (key) {
      case '_': // extra arguments
        [ _script, ..._scriptArgs ] = value
        break
      case 'help': // help screen
        return _help()
      case 'version': // version dump
        console.log(`v${__version}`)
        process.exitCode = 1
        return
      case 'eval': // eval script
        _eval = value
        break
      case 'print': // eval script and print return value
        _print = true
        _eval = true
        break
    }
  }

  // Start the repl or run the script?
  if (! _script) {
    // No script? Then repl
    return new Promise((resolve, reject) => {
      // Some niceties for welcoming to tsrun
      console.log(`Welcome to Node.js ${process.version} (tsrun v${__version}).`)
      console.log('Type ".help" for more information.')

      // Start our repl
      const repl = _repl.start()

      // Setup and track history
      const history = _path.resolve(_os.homedir(), '.node_repl_history')
      repl.setupHistory(history, (error) => {
        if (! error) return
        reject(error)
        repl.close()
      })

      // On exit, let the process exit
      repl.on('exit', () => resolve())
    })
  } else if (_eval) {
    // If we are evaluating a script, we need to use some node internals to do
    // all the tricks to run this... We a fake script running the code to
    // evaluate, instrumenting "globalThis" with all required vars and modules
    const script = `
      globalThis.module = module;
      globalThis.require = require;
      globalThis.exports = exports;
      globalThis.__dirname = __dirname;
      globalThis.__filename = __filename;

      for (const module of require('repl').builtinModules) {
        if (module.indexOf('/') >= 0) continue;
        if (Object.hasOwn(globalThis, module)) continue;
        Object.defineProperty(globalThis, module, { get: () => require(module) });
      }

      return require('node:vm').runInThisContext(${JSON.stringify(_script)}, '[eval]')
    `

    // Use the Node internal "Module._compile" to compile and run our script
    const result = (new _module('[eval]') as any)._compile(script, '[eval]')

    // If we need to print, then let's do it!
    if (_print) console.log(result)
  } else {
    // Resolve the _full_ path of the script, and tweak our process.argv
    // arguments, them simply import the script and let Node do its thing...
    _script = _path.resolve(process.cwd(), _script)
    process.argv = [ process.argv0, _script, ..._scriptArgs ]
    import(_script)
  }
})
