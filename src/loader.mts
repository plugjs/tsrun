/* ========================================================================== *
 * HACK BEYOND REDEMPTION: TRANSPILE .ts FILES (the esm loader)               *
 * -------------------------------------------------------------------------- *
 * This relies on the Node's `--experimental-loader` feature, and uses        *
 * ESBuild build magic to quickly transpile TypeScript files into JavaScript. *
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
import _module from 'node:module'
import _path from 'node:path'
import _url from 'node:url'
import _util from 'node:util'

// ESBuild is the only external dependency
import _esbuild from 'esbuild'

// Local imports

/* ========================================================================== *
 * DEBUGGING AND ERRORS                                                       *
 * ========================================================================== */

/** Supported types from `package.json` */
export type Type = 'commonjs' | 'module'
/** Constant identifying a `commonjs` module */
const CJS = 'commonjs'
/** Constant identifying an ESM `module` */
const ESM = 'module'

/** Setup debugging */
const _debugLog = _util.debuglog('plug:ts-loader')
const _debug = _debugLog.enabled

/** Emit some logs if `DEBUG_TS_LOADER` is set to `true` */
function _log(type: Type | null, arg: string, ...args: any []): void {
  if (! _debug) return

  const t = type === ESM ? 'esm' : type === CJS ? 'cjs' : '---'
  _debugLog(`[${t}] ${arg}`, ...args)
}

/** Fail miserably */
function _throw(
    type: Type | null,
    message: string,
    options: { start?: Function, code?: string, cause?: any } = {},
): never {
  const t = type === ESM ? 'esm' : type === CJS ? 'cjs' : '---'
  const prefix = `[ts-loader|${t}|pid=${process.pid}]`

  const { start = _throw, ...extra } = options
  const error = new Error(`${prefix} ${message}`)
  Error.captureStackTrace(error, start)
  Object.assign(error, extra)

  throw error
}


/* ========================================================================== *
 * MODULE TYPES AND FORCING TYPE                                              *
 * ========================================================================== */

function _checkType(type: string): Type {
  if (type === CJS) return CJS
  if (type === ESM) return ESM
  _throw(null, `Invalid type "${process.env.__TS_LOADER_FORCE_TYPE}"`)
}

let _type: Type = ((): Type => {
  if (process.env.__TS_LOADER_FORCE_TYPE) {
    const type = process.env.__TS_LOADER_FORCE_TYPE
    _log(null, `Forcing type to "${type}" from environment`)
    return _checkType(type)
  }

  const findType = (directory: string): Type => {
    const packageFile = _path.join(directory, 'package.json')
    try {
      const packageData = _fs.readFileSync(packageFile, 'utf-8')
      const packageJson = JSON.parse(packageData)
      const packageType = packageJson.type
      switch (packageType) {
        case undefined:
          _log(null, `File "${packageFile}" does not declare a default type`)
          return CJS

        case CJS:
        case ESM:
          _log(null, `File "${packageFile}" declares type as "${CJS}"`)
          return packageType

        default:
          _log(null, `File "${packageFile}" specifies unknown type "${packageType}"`)
          return CJS
      }
    } catch (cause: any) {
      if ((cause.code !== 'ENOENT') && (cause.code !== 'EISDIR')) {
        _throw(null, `Unable to read or parse "${packageFile}"`, { cause, start: findType })
      }
    }

    const parent = _path.dirname(directory)
    if (directory !== parent) return findType(directory)

    _log(null, `Type defaulted to "${CJS}"`)
    return CJS
  }

  return findType(process.cwd())
})()

/* The `tsLoaderMarker` (symbol in global) will be a setter/getter for type */
const tsLoaderMarker = Symbol.for('plugjs:tsLoader')

Object.defineProperty(globalThis, tsLoaderMarker, {
  set(type: string): void {
    _log(null, `Setting type to "${type}"`)
    process.env.__TS_LOADER_FORCE_TYPE = _type = _checkType(type)
  },
  get(): Type {
    return _type
  },
})


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
function _esbTranpile(filename: string, type: Type): string {
  _log(type, `Transpiling "${filename}`)

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
    _throw(type, `ESBuild error transpiling "${filename}"`, { cause, start: _esbTranpile })
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
 * ESM VERSION                                                                *
 * ========================================================================== */

/** The formats that can be handled by NodeJS' loader */
type Format = 'builtin' | 'commonjs' | 'json' | 'module' | 'wasm'

/* ========================================================================== */

/** The type identifying a NodeJS' loader `resolve` hook. */
type ResolveHook = (
  /** Whatever was requested to be imported (module, relative file, ...). */
  specifier: string,
  /** Context information around this `resolve` hook call. */
  context: ResolveContext,
  /** The subsequent resolve hook in the chain, or the Node.js default one. */
  nextResolve: ResolveNext,
) => ResolveResult | Promise<ResolveResult>

/** Context information around a `resolve` hook call. */
interface ResolveContext {
  importAssertions: object
  /** Export conditions of the relevant `package.json`. */
  conditions: string[]
  /** The module importing this one, or undefined if this is the entry point. */
  parentURL?: string | undefined
}

/** The subsequent resolve hook in the chain, or the Node.js default one. */
type ResolveNext = (specifier: string, context: ResolveContext) => ResolveResult | Promise<ResolveResult>

/** A type describing the required results from a `resolve` hook */
interface ResolveResult {
  /** The absolute URL to which this input resolves. */
  url: string
  /** A format hint to the `load` hook (it might be ignored). */
  format?: Format | null | undefined
  /** A signal that this hook intends to terminate the chain of resolve hooks. */
  shortCircuit?: boolean | undefined
}

/* ========================================================================== */

/** The type identifying a NodeJS' loader `load` hook. */
type LoadHook = (
  /** The URL returned by the resolve chain. */
  url: string,
  /** Context information around this `load` hook call. */
  context: LoadContext,
  /** The subsequent load hook in the chain, or the Node.js default one. */
  nextLoad: LoadNext,
) => LoadResult | Promise<LoadResult>

/** Context information around a `load` hook call. */
interface LoadContext {
  importAssertions: object
  /** Export conditions of the relevant `package.json` */
  conditions: string[]
  /** The format hint from the `resolve` hook. */
  format?: ResolveResult['format']
}

/** The subsequent load hook in the chain, or the Node.js default one. */
type LoadNext = (url: string, context: LoadContext) => LoadResult | Promise<LoadResult>

/** A type describing the required results from a `resolve` hook */
type LoadResult = {
  /** The format of the code being loaded. */
  format: Format
  /** A signal that this hook intends to terminate the chain of load hooks. */
  shortCircuit?: boolean | undefined
} & ({
  format: 'builtin' | 'commonjs'
  /** When the source is `builtin` or `commonjs` no source must be returned */
  source?: never | undefined
} | {
  format: 'json' | 'module'
  /** When the source is `json` or `module` the source can include strings */
  source: string | ArrayBuffer | NodeJS.TypedArray
} | {
  format: 'wasm'
  /** When the source is `wasm` the source must not be a string */
  source: ArrayBuffer | NodeJS.TypedArray
})

/* ========================================================================== */

/**
 * Our main `resolve` hook: here we need to check for a couple of options
 * when importing ""
 */
export const resolve: ResolveHook = (specifier, context, nextResolve): ResolveResult | Promise<ResolveResult> => {
  _log(ESM, `Resolving "${specifier}" from "${context.parentURL}"`)

  /* We only resolve relative paths ("./xxx" or "../xxx") */
  if (! specifier.match(/^\.\.?\//)) return nextResolve(specifier, context)

  /* We only resolve if we _do_ have a parent URL and it's a file */
  const parentURL = context.parentURL
  if (! parentURL) return nextResolve(specifier, context)
  if (! parentURL.startsWith('file:')) return nextResolve(specifier, context)

  /* We only resolve here if the importer is a ".ts" or ".mts" file */
  if (! parentURL.match(/\.m?ts$/)) return nextResolve(specifier, context)

  /* The resolved URL is the specifier resolved against the parent */
  const url = new URL(specifier, parentURL).href
  const path = _url.fileURLToPath(url)

  /*
   * Here we are sure that:
   *
   * 1) we are resolving a local path (not a module)
   * 2) the importer is a file, ending with ".ts" or ".mts"
   *
   * Now we can check if "import 'foo'" resolves to:
   *
   * 1) directly to a file, e.g. "import './foo.js'" or "import './foo.mts'"
   * 2) import a "pseudo-JS file", e.g. "import './foo.js'" becomes "import './foo.ts'"
   * 3) imports a file without extension as if it were "import './foo.ts'"
   * 4) imports a directory  as in "import './foo/index.ts'"
   *
   * We resolve the _final_ specifier that will be passed to the next resolver
   * for further potential resolution accordingly.
   *
   * We start with the easiest case: is this a real file on the disk?
   */
  if (isFile(path)) {
    _log(ESM, `Positive match for "${specifier}" as "${path}" (1)`)
    return nextResolve(specifier, context) // straight on
  }

  /*
   * TypeScript allows us to import "./foo.js", and internally resolves this to
   * "./foo.ts" (yeah, nice, right?) and while we normally wouldn't want to deal
   * with this kind of stuff, the "node16" module resolution mode _forces_ us to
   * use this syntax.
   */
  const match = specifier.match(/(.*)(\.[mc]?js$)/)
  if (match) {
    const [ , base, ext ] = match
    const tsspecifier = base + ext!.replace('js', 'ts')
    const tsurl = new URL(tsspecifier, parentURL).href
    const tspath = _url.fileURLToPath(tsurl)

    if (isFile(tspath)) {
      _log(ESM, `Positive match for "${specifier}" as "${tspath}" (2)`)
      return nextResolve(tsspecifier, context) // straight on
    }
  }

  /* Check if the import is actually a file with a ".ts" extension */
  if (isFile(`${path}.ts`)) {
    _log(ESM, `Positive match for "${specifier}.ts" as "${path}.ts" (3)`)
    return nextResolve(`${specifier}.ts`, context)
  }

  /* If the file is a directory, then see if we have an "index.ts" in there */
  if (isDirectory(path)) {
    const file = _path.resolve(path, 'index.ts') // resolve, as path is absolute
    if (isFile(file)) {
      _log(ESM, `Positive match for "${specifier}" as "${file}"  (4)`)
      const spec = _url.pathToFileURL(file).pathname
      return nextResolve(spec, context)
    }
  }

  /* There's really nothing else we can do */
  return nextResolve(specifier, context)
}

/** Our main `load` hook */
export const load: LoadHook = (url, context, nextLoad): LoadResult | Promise<LoadResult> => {
  _log(ESM, `Attempting to load "${url}"`)

  /* We only load from disk, so ignore everything else */
  if (! url.startsWith('file:')) return nextLoad(url, context)

  /* Figure our the extension (especially ".ts", ".mts" or ".cts")... */
  const ext = url.match(/\.[cm]?ts$/)?.[0]

  /* Quick and easy bail-outs for non-TS or ".cts" (always `commonjs`) */
  if (! ext) return nextLoad(url, context)

  if (ext === '.cts') {
    if (_debug) {
      _log(null, `Switching type from "module" to "commonjs" for "${url}"`)
      _log(null, 'Please note that named import WILL NOT WORK in this case, as Node.js performs a')
      _log(null, 'static analisys on the CommonJS source code, and this file is transpiled from.')
      _log(null, 'TypeScript to CommonJS dynamically.')
    }
    return { format: CJS, shortCircuit: true }
  }

  /* Convert the url into a file name, any error gets ignored */
  const filename = _url.fileURLToPath(url)

  /* If the file is a ".ts", we need to figure out the default type */
  if (ext === '.ts') {
    if (_type === CJS) {
      if (_debug) {
        _log(null, `Switching type from "module" to "commonjs" for "${url}"`)
        _log(null, 'Please note that named import WILL NOT WORK in this case, as Node.js performs a')
        _log(null, 'static analisys on the CommonJS source code, and this file is transpiled from.')
        _log(null, 'TypeScript to CommonJS dynamically.')
      }
      return { format: CJS, shortCircuit: true }
    }
  }

  /* Transpile with ESBuild and return our source code */
  const source = _esbTranpile(filename, ESM)
  return { source, format: ESM, shortCircuit: true }
}


/* ========================================================================== *
 * CJS VERSION                                                                *
 * ========================================================================== */

/** The extension handler type, loading CJS modules */
type ExtensionHandler = (module: NodeJS.Module, filename: string) => void

/* Add the `_compile(...)` method to NodeJS' `Module` interface */
declare global {
  namespace NodeJS {
    interface Module {
      _compile: (contents: string, filename: string) => void
    }
  }
}

/**
 * Add the `_extensions[...]` and `resolveFilename(...)` members to the
 * definition of `node:module`.
 */
declare module 'node:module' {
  const _extensions: Record<`.${string}`, ExtensionHandler>
  function _resolveFilename(
    request: string,
    parent: _module | undefined,
    isMain: boolean,
    options?: any,
  ): string
}

/* ========================================================================== */

const loader: ExtensionHandler = (module, filename): void => {
  _log(CJS, `Attempting to load "${filename}"`)

  /* Figure our the extension (".ts" or ".cts")... */
  const ext = _path.extname(filename)

  /* If the file is a ".ts", we need to figure out the default type */
  if (ext === '.ts') {
    /* If the _default_ module type is CJS then load as such! */
    if (_type === ESM) {
      _throw(CJS, `Must use import to load ES Module: ${filename}`, { code: 'ERR_REQUIRE_ESM' })
    }
  } else if (ext !== '.cts') {
    _throw(CJS, `Unsupported filename "${filename}"`)
  }

  const source = _esbTranpile(filename, CJS)

  /* Let node do its thing, but wrap any error it throws */
  try {
    module._compile(source, filename)
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.error(`Error compiling module "${filename}"`, cause)
  }
}

/* Remember to load our loader for .TS/.CTS as CommonJS modules */
_module._extensions['.ts'] = _module._extensions['.cts'] = loader

/**
 * Replace _module._resolveFilename with our own.
 *
 * This is a _HACK BEYOND REDEMPTION_ and I'm ashamed of even _thinking_ about
 * it, but, well, it makes things work.
 *
 * TypeScript allows us to import "./foo.js", and internally resolves this to
 * "./foo.ts" (yeah, nice, right?) and while we normally wouldn't want to deal
 * with this kind of stuff, the "node16" module resolution mode _forces_ us to
 * use this syntax.
 *
 * And we _need_ the "node16" module resolution to properly consume "export
 * conditions" from other packages. Since ESBuild's plugins only work in async
 * mode, changing those import statements on the fly is out of the question, so
 * we need to hack our way into Node's own resolver.
 *
 * See my post: https://twitter.com/ianosh/status/1559484168685379590
 * ESBuild related fix: https://github.com/evanw/esbuild/commit/0cdc005e3d1c765a084f206741bc4bff78e30ec4
 */
const _oldResolveFilename = _module._resolveFilename
_module._resolveFilename = function(
    request: string,
    parent: _module | undefined,
    ...args: [ isMain: boolean, options: any ]
): any {
  try {
    /* First call the old _resolveFilename to see what Node thinks */
    return _oldResolveFilename.call(this, request, parent, ...args)
  } catch (error: any) {
    /* If the error was anything but "MODULE_NOT_FOUND" bail out */
    if (error.code !== 'MODULE_NOT_FOUND') throw error

    /* Check if the "request" ends with ".js", ".mjs" or ".cjs" */
    const match = request.match(/(.*)(\.[mc]?js$)/)

    /*
     * If the file matches our extension, _and_ we have a parent, we simply
     * try with a new extension (e.g. ".js" becomes ".ts")...
     */
    if (parent && match) {
      const [ , name, ext ] = match
      const tsrequest = name + ext!.replace('js', 'ts')
      try {
        const result = _oldResolveFilename.call(this, tsrequest, parent, ...args)
        _log(CJS, `Resolution for "${request}" intercepted as "${tsrequest}`)
        return result
      } catch (discard) {
        throw error // throw the _original_ error in this case
      }
    }

    /* We have no parent, or we don't match our extension, throw! */
    throw error
  }
}
