/* eslint-disable no-console */
import _childProcess from 'node:child_process'
import _fs from 'node:fs'
import _module from 'node:module'
import _url from 'node:url'
import _util from 'node:util'

import _yargs from './parser.mjs'

/* ========================================================================== *
 * PRETTY COLORS                                                              *
 * ========================================================================== */

/** Reset all colors to default */
export const $rst = process.stdout.isTTY ? '\u001b[0m' : ''
/** Set _underline_ on */
export const $und = process.stdout.isTTY ? '\u001b[4m' : ''
/** Set _somewhat gray_ on */
export const $gry = process.stdout.isTTY ? '\u001b[38;5;240m' : ''
/** Set _brighter blue_ on */
export const $blu = process.stdout.isTTY ? '\u001b[38;5;69m' : ''
/** Set _full bright white_ on */
export const $wht = process.stdout.isTTY ? '\u001b[1;38;5;255m' : ''
/** Set _purplish indigo_ on (the color of tasks) */
export const $tsk = process.stdout.isTTY ? '\u001b[38;5;141m' : ''

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
 * UTILITIES                                                                  *
 * ========================================================================== */

/* Re-export `yargs-parser` */
export const yargsParser = _yargs

/* Returns a boolean indicating whether the specified file exists or not */
export function isFile(path: string): boolean {
  try {
    return _fs.statSync(path).isFile()
  } catch (error) {
    return false
  }
}

/* Returns a boolean indicating whether the specified directory exists or not */
export function isDirectory(path: string): boolean {
  try {
    return _fs.statSync(path).isDirectory()
  } catch (error) {
    return false
  }
}


/* ========================================================================== *
 * MAIN ENTRY POINT                                                           *
 * ========================================================================== */

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
    const args = process.argv.slice(2).filter((arg: string): string | void => {
      if (arg === '--force-esm') {
        return forceType('module')
      } else if (arg === '--force-cjs') {
        return forceType('commonjs')
      } else {
        return arg
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
