// NodeJS dependencies
import _module from 'node:module'
import _path from 'node:path'

import {
  CJS,
  ESM,
  esbTranpile,
  logMessage,
  moduleType,
  throwError,
} from './loader-shared'

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

const _type = moduleType(CJS)

const loader: ExtensionHandler = (module, filename): void => {
  logMessage(CJS, `Attempting to load "${filename}"`)

  /* Figure our the extension (".ts" or ".cts")... */
  const ext = _path.extname(filename)

  /* If the file is a ".ts", we need to figure out the default type */
  if (ext === '.ts') {
    /* If the _default_ module type is CJS then load as such! */
    if (_type === ESM) {
      throwError(CJS, `Must use import to load ES Module: ${filename}`, { code: 'ERR_REQUIRE_ESM' })
    }
  } else if (ext !== '.cts') {
    throwError(CJS, `Unsupported filename "${filename}"`)
  }

  const source = esbTranpile(filename, CJS)

  /* Let node do its thing, but wrap any error it throws */
  try {
    module._compile(source, filename)
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.error(`Error compiling module "${filename}"`, cause)
  }
}

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
        logMessage(CJS, `Resolution for "${request}" intercepted as "${tsrequest}`)
        return result
      } catch (discard) {
        throw error // throw the _original_ error in this case
      }
    }

    /* We have no parent, or we don't match our extension, throw! */
    throw error
  }
}

/* ========================================================================== */

/* Remember to load our loader for .TS/.CTS as CommonJS modules */
_module._extensions['.ts'] = _module._extensions['.cts'] = loader
logMessage(CJS, 'TypeScript loader for CommonJS loaded')
