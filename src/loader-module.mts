import _path from 'node:path'
import _url from 'node:url'

import {
  CJS,
  ESM,
  esbTranpile,
  isDirectory,
  isFile,
  logMessage,
  moduleType,
} from './loader-shared'

import type { LoadFnOutput, LoadHookSync, ResolveFnOutput, ResolveHookSync } from 'node:module'

/* ========================================================================== *
 * ESM VERSION                                                                *
 * ========================================================================== */

const _type = moduleType(CJS)

/**
 * Our main `resolve` hook: here we need to check for a couple of options
 * when importing ""
 */
export const resolve: ResolveHookSync = (specifier, context, nextResolve): ResolveFnOutput => {
  logMessage(ESM, `Resolving "${specifier}" from "${context.parentURL}"`)

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
    logMessage(ESM, `Positive match for "${specifier}" as "${path}" (1)`)
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
      logMessage(ESM, `Positive match for "${specifier}" as "${tspath}" (2)`)
      return nextResolve(tsspecifier, context) // straight on
    }
  }

  /* Check if the import is actually a file with a ".ts" extension */
  if (isFile(`${path}.ts`)) {
    logMessage(ESM, `Positive match for "${specifier}.ts" as "${path}.ts" (3)`)
    return nextResolve(`${specifier}.ts`, context)
  }

  /* If the file is a directory, then see if we have an "index.ts" in there */
  if (isDirectory(path)) {
    const file = _path.resolve(path, 'index.ts') // resolve, as path is absolute
    if (isFile(file)) {
      logMessage(ESM, `Positive match for "${specifier}" as "${file}"  (4)`)
      const spec = _url.pathToFileURL(file).pathname
      return nextResolve(spec, context)
    }
  }

  /* There's really nothing else we can do */
  return nextResolve(specifier, context)
}

/** Our main `load` hook */
export const load: LoadHookSync = (url, context, nextLoad): LoadFnOutput => {
  logMessage(ESM, `Attempting to load "${url}"`)

  /* We only load from disk, so ignore everything else */
  if (! url.startsWith('file:')) return nextLoad(url, context)

  /* Figure our the extension (especially ".ts", ".mts" or ".cts")... */
  const ext = url.match(/\.[cm]?ts$/)?.[0]

  /* Quick and easy bail-outs for non-TS or ".cts" (always `commonjs`) */
  if (! ext) return nextLoad(url, context)

  if (ext === '.cts') {
    logMessage(ESM, `Switching type from "module" to "commonjs" for "${url}"`)
    logMessage(ESM, 'Please note that named import WILL NOT WORK in this case, as Node.js performs a')
    logMessage(ESM, 'static analisys on the CommonJS source code, and this file is transpiled from.')
    logMessage(ESM, 'TypeScript to CommonJS dynamically.')
    return { format: CJS, shortCircuit: true }
  }

  /* Convert the url into a file name, any error gets ignored */
  const filename = _url.fileURLToPath(url)

  /* If the file is a ".ts", we need to figure out the default type */
  if (ext === '.ts') {
    if (_type === CJS) {
      logMessage(ESM, `Switching type from "module" to "commonjs" for "${url}"`)
      logMessage(ESM, 'Please note that named import WILL NOT WORK in this case, as Node.js performs a')
      logMessage(ESM, 'static analisys on the CommonJS source code, and this file is transpiled from.')
      logMessage(ESM, 'TypeScript to CommonJS dynamically.')
      return { format: CJS, shortCircuit: true }
    }
  }

  /* Transpile with ESBuild and return our source code */
  const source = esbTranpile(filename, ESM)
  return { source, format: ESM, shortCircuit: true }
}

/* ========================================================================== */

/* Simply output the fact that we were loaded */
logMessage(ESM, 'TypeScript loader for ES Modules loaded')
