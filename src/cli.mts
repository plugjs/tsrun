/* eslint-disable no-console */
import _childProcess from 'node:child_process'
import _module from 'node:module'
import _url from 'node:url'
import _util from 'node:util'

import _yargs from './parser.mjs'

/* ========================================================================== *
 * TS LOADER FORCE TYPE                                                       *
 * ========================================================================== */

function forceType(type: 'commonjs' | 'module'): void {
  const debug = _util.debuglog('plug:cli')

  const tsLoaderMarker = Symbol.for('plugjs:tsLoader')

  if (!(tsLoaderMarker in globalThis)) {
    throw new Error('TypeScript Loader not available')
  }
  debug(`Forcing type to "${type}"`)
  ;(globalThis as any)[tsLoaderMarker] = type
}

/* ========================================================================== *
 * ESPORTS                                                                    *
 * ========================================================================== */

/** Bundled-in `yargs-parser` */
export const yargsParser = _yargs

/**
 * Wrap around the `main` process of a CLI.
 *
 * This function must be invoked with a script URL (the `import.meta.url`
 * variable of the script being executed) and a callback, which will be invoked
 * once the proper environment for TypeScript has been setup.
 *
 * The callback _might_ return a promise (can be asynchronous) which will be
 * awaited for potential rejections.
 */
export function main(
    scriptUrl: string,
    callback: (args: string[]) => void | Promise<void>,
): void {
  const debug = _util.debuglog('plug:cli')

  /* Check for source maps and typescript support */
  const sourceMapsEnabled = process.execArgv.indexOf('--enable-source-maps') >= 0

  /* Check if our `loader` loader is enabled */
  const tsLoaderMarker = Symbol.for('plugjs:tsLoader')
  const typeScriptEnabled = (globalThis as any)[tsLoaderMarker]

  /* Some debugging if needed */
  debug('SourceMaps enabled =', sourceMapsEnabled)
  debug('TypeScript enabled =', typeScriptEnabled || false)

  /* If both source maps and typescript are on, run! */
  if (sourceMapsEnabled && typeScriptEnabled) {
    const args = process.argv.slice(2).filter((arg: string): boolean => {
      if (arg === '--force-esm') {
        return (forceType('module'), false)
      } else if (arg === '--force-cjs') {
        return (forceType('commonjs'), false)
      } else {
        return true
      }
    })

    /* Wrap into a promise to better catch errors from the real "main" */
    Promise.resolve().then(async () => {
      process.exitCode = 0
      await callback(args)
    }).catch((error) => {
      console.error(error)
      process.exitCode = 1

      setTimeout(() => {
        console.log('\n\nProcess %d did not exit in 5 seconds', process.pid)
        process.exit(2)
      }, 5000).unref()
    })
  } else {
    const script = _url.fileURLToPath(scriptUrl)

    /* Fork out ourselves with new options */
    const execArgv = [ ...process.execArgv ]

    /* Enable source maps if not done already */
    if (! sourceMapsEnabled) execArgv.push('--enable-source-maps')

    /* Enable our ESM TypeScript loader if not done already */
    if (! typeScriptEnabled) {
      const require = _module.createRequire(import.meta.url)
      const loader = require.resolve('./loader.mjs')
      debug(`TypeScript loader resolved to "${loader}"`)
      execArgv.push(`--experimental-loader=${loader}`, '--no-warnings')
    }

    /* Fork ourselves! */
    debug('Forking', script, ...process.argv.slice(2))
    const child = _childProcess.fork(script, [ ...process.argv.slice(2) ], {
      stdio: [ 'inherit', 'inherit', 'inherit', 'ipc' ],
      execArgv,
    })

    /* Monitor child process... */
    child.on('error', (error) => {
      console.log('Error respawning CLI', error)
      process.exit(1)
    })

    child.on('exit', (code, signal) => {
      if (signal) {
        console.log(`CLI process exited with signal ${signal}`)
        process.exit(1)
      } else if (typeof code !== 'number') {
        console.log('CLI process failed for an unknown reason')
        process.exit(1)
      } else {
        process.exit(code)
      }
    })
  }
}
