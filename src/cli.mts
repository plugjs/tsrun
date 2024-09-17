import _childProcess from 'node:child_process'
import _module from 'node:module'
import _url from 'node:url'
import _util from 'node:util'

import yargs from './parser.mjs'

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

/** Bundled-in `yargs-parser` */
export const yargsParser = yargs

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
  const require = _module.createRequire(import.meta.url)
  const debug = _util.debuglog('plug:cli')

  /* Always enable source maps support */
  process.setSourceMapsEnabled(true)

  /* Process command line arguments, filtering any "--force-..." */
  const args = process.argv.slice(2).filter((arg: string): boolean => {
    if (arg === '--force-esm') {
      process.env.__TS_LOADER_FORCE_TYPE = 'module'
      return false
    } else if (arg === '--force-cjs') {
      process.env.__TS_LOADER_FORCE_TYPE = 'commonjs'
      return false
    } else {
      return true
    }
  })

  /* Assume that Typescript loading is _not_ enabled */
  let typeScriptEnabled = false

  /* If we have the "_module.register" hook in place we can work in-process */
  if (typeof _module.register === 'function') {
    debug('Enabling in-process TypeScript loader')

    /* Register the ESM loader and immediately require the CJS loader */
    _module.register('./loader-module.mjs', import.meta.url)
    require('./loader-commonjs.cjs')

    /* Add our preloader to the "execArgv" arguments to support forking */
    process.execArgv.push(`--import=${require.resolve('./preload.mjs')}`)

    /* Yep, typescript is enabled */
    typeScriptEnabled = true
  }

  /* If we don't have TypeScript enabled check the NodeJS command line */
  if (! typeScriptEnabled) {
    const cjsLoader = require.resolve('./loader-commonjs.cjs')
    const esmLoader = require.resolve('./loader-module.mjs')

    if (process.execArgv.includes(`--experimental-loader=${esmLoader}`)) {
      typeScriptEnabled = true
    } else if (process.execArgv.includes(`--loader=${esmLoader}`)) {
      typeScriptEnabled = true
    } else {
      process.execArgv.push(`--experimental-loader=${esmLoader}`)
      process.execArgv.push(`--require=${cjsLoader}`)
      process.execArgv.push('--no-warnings')
      typeScriptEnabled = false
    }
  }


  /* If TypeScript is enabled, then we can simply run now! */
  if (typeScriptEnabled) {
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

    return
  }

  /* If TypeScript is not enabled, then we have to fork with the new execArgh! */
  const script = _url.fileURLToPath(scriptUrl)
  debug('Forking', process.execPath, ...process.execArgv, script, ...process.argv.slice(2))
  const child = _childProcess.fork(script, [ ...process.argv.slice(2) ], {
    stdio: [ 'inherit', 'inherit', 'inherit', 'ipc' ],
    execArgv: process.execArgv,
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
