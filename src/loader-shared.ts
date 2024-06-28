/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* ========================================================================== *
 * HACK BEYOND REDEMPTION: TRANSPILE .ts FILES (the esm loader)               *
 * -------------------------------------------------------------------------- *
 * Use ESBuild to quickly transpile TypeScript files into JavaScript.         *
 *                                                                            *
 * The plan as it stands is as follows:                                       *
 * - `.mts` files always get transpiled to ESM modules                        *
 * - `.cts` files always get transpiled to CJS modules                        *
 * - `.ts` files are treanspiled according to what's in `package.json`        *
 *                                                                            *
 * Additionally, when transpiling to ESM modules, we can't rely on the magic  *
 * that Node's `require(...)` call uses to figure out which file to import.   *
 * We need to _actually verify_ on disk what's the correct file to import.    *
 *                                                                            *
 * This is a single module, only available as ESM, and it will _both_ behave  *
 * as a NodeJS' loader, _and_ inject the CJS extension handlers (hack) found  *
 * in the `_extensions` of `node:module` (same as `require.extensions`).      *
 * ========================================================================== */

// NodeJS dependencies
import _fs from 'node:fs'
import _path from 'node:path'
import _util from 'node:util'

// ESBuild is the only external dependency
import _esbuild from 'esbuild'

/* ========================================================================== *
 * CONSTANTS AND TYPES                                                        *
 * ========================================================================== */

/** Supported types from `package.json` */
export type Type = 'commonjs' | 'module'
/** Constant identifying a `commonjs` module */
export const CJS = 'commonjs' as const
/** Constant identifying an ESM `module` */
export const ESM = 'module' as const

/* ========================================================================== *
 * DEBUGGING AND ERRORS                                                       *
 * ========================================================================== */

/** Setup debugging */
const _debugLog = _util.debuglog('plug:ts-loader')
const _debug = _debugLog.enabled

/** Emit some logs if `DEBUG_TS_LOADER` is set to `true` */
export function logMessage(mode: Type, arg: string, ...args: any []): void {
  if (! _debug) return

  const t = mode === ESM ? 'esm' : mode === CJS ? 'cjs' : '---'
  _debugLog(`[${t}] ${arg}`, ...args)
}

/** Fail miserably */
export function throwError(
    mode: Type,
    message: string,
    options: { start?: Function, code?: string, cause?: any } = {},
): never {
  const t = mode === ESM ? 'esm' : mode === CJS ? 'cjs' : '---'
  const prefix = `[ts-loader|${t}|pid=${process.pid}]`

  const { start = throwError, ...extra } = options
  const error = new Error(`${prefix} ${message}`)
  Error.captureStackTrace(error, start)
  Object.assign(error, extra)

  throw error
}

/* ========================================================================== *
 * MODULE TYPES AND FORCING TYPE                                              *
 * ========================================================================== */

/**
 * Determine the current module type to transpile .TS files as looking at the
 * `__TS_LOADER_FORCE_TYPE` environment variable (used by PlugJS and CLI) or,
 * if unspecified, looking at the `type` field in the `package.json` file.
 */
export function moduleType(mode: Type): Type {
  if (process.env.__TS_LOADER_FORCE_TYPE) {
    const type = process.env.__TS_LOADER_FORCE_TYPE
    if ((type === CJS) || (type === ESM)) {
      logMessage(mode, `Forcing type to "${type}" from environment`)
      return type
    } else {
      throwError(mode, `Invalid type "${process.env.__TS_LOADER_FORCE_TYPE}"`)
    }
  }

  const _findType = (directory: string): Type => {
    const packageFile = _path.join(directory, 'package.json')
    try {
      const packageData = _fs.readFileSync(packageFile, 'utf-8')
      const packageJson = JSON.parse(packageData)
      const packageType = packageJson.type
      switch (packageType) {
        case undefined:
          logMessage(mode, `File "${packageFile}" does not declare a default type`)
          return CJS

        case CJS:
        case ESM:
          logMessage(mode, `File "${packageFile}" declares type as "${CJS}"`)
          return packageType

        default:
          logMessage(mode, `File "${packageFile}" specifies unknown type "${packageType}"`)
          return CJS
      }
    } catch (cause: any) {
      if ((cause.code !== 'ENOENT') && (cause.code !== 'EISDIR')) {
        throwError(mode, `Unable to read or parse "${packageFile}"`, { cause, start: _findType })
      }
    }

    const parent = _path.dirname(directory)
    if (directory !== parent) return _findType(directory)

    logMessage(mode, `Type defaulted to "${CJS}"`)
    return CJS
  }

  return _findType(process.cwd())
}

/* ========================================================================== *
 * ESBUILD HELPERS                                                            *
 * ========================================================================== */

/**
 * Take an ESBuild `BuildResult` or `BuildFailure` (they both have arrays
 * of `Message` in both `warnings` and `errors`), format them and print them
 * out nicely. Then fail if any error was detected.
 */
function _esbReport(
    kind: 'error' | 'warning',
    messages: _esbuild.Message[] = [],
): void {
  const output = process.stderr
  const options = { color: !!output.isTTY, terminalWidth: output.columns || 80 }

  const array = _esbuild.formatMessagesSync(messages, { kind, ...options })
  array.forEach((message) => output.write(`${message}\n`))
}

/**
 * Transpile with ESBuild
 */
export function esbTranpile(filename: string, type: Type): string {
  logMessage(type, `Transpiling "${filename}" as "${type}"`)

  const [ format, __fileurl ] = type === ESM ?
    [ 'esm', 'import.meta.url' ] as const :
    [ 'cjs', '__filename' ] as const

  /* ESbuild options */
  const options: _esbuild.TransformOptions = {
    sourcefile: filename, // the original filename we're parsing
    format, // what are we actually transpiling to???
    loader: 'ts', // the format is always "typescript"
    sourcemap: 'inline', // always inline source maps
    sourcesContent: false, // do not include sources content in sourcemap
    platform: 'node', // d'oh! :-)
    minifyWhitespace: true, // https://github.com/evanw/esbuild/releases/tag/v0.16.14
    logLevel: 'silent', // catching those in our _esbReport below
    target: `node${process.versions['node']}`, // target _this_ version
    define: { __fileurl }, // from "globals.d.ts"
  }

  /* Emit a line on the console when loading in debug mode */
  if (_debug) {
    if (format === 'esm') {
      options.banner = `;(await import('node:util')).debuglog('plug:ts-loader')('[esm] Loaded "%s"', ${__fileurl});`
    } else if (format === 'cjs') {
      options.banner = `;require('node:util').debuglog('plug:ts-loader')('[cjs] Loaded "%s"', ${__fileurl});`
    }
  }

  /* Transpile our TypeScript file into some JavaScript stuff */
  let result
  try {
    const source = _fs.readFileSync(filename, 'utf-8')
    result = _esbuild.transformSync(source, options)
  } catch (cause: any) {
    _esbReport('error', (cause as _esbuild.TransformFailure).errors)
    _esbReport('warning', (cause as _esbuild.TransformFailure).warnings)
    throwError(type, `ESBuild error transpiling "${filename}"`, { cause, start: esbTranpile })
  }

  /* Log transpile warnings if debugging */
  if (_debug) _esbReport('warning', result.warnings)

  /* Done! */
  return result.code
}


/* ========================================================================== *
 * UTILITIES                                                                  *
 * ========================================================================== */

/* Returns a boolean indicating whether the specified file exists or not */
export function isFile(path: string): boolean {
  try {
    return _fs.statSync(path).isFile()
  } catch {
    return false
  }
}

/* Returns a boolean indicating whether the specified directory exists or not */
export function isDirectory(path: string): boolean {
  try {
    return _fs.statSync(path).isDirectory()
  } catch {
    return false
  }
}
