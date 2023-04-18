A simple TypeScript runner
--------------------------

Used extensively by the [PlugJS Build System](https://github.com/plugjs/plug),
`tsrun` is an extremely simple (but fast) script runner for TypeScript
supporting **EcmaScript** modules _and_ **CommonJS** modules.

Used as a command line utility, it offers few options:

```
tsrun [--options] script.ts [...script args]

Options:

    -h --help       Help! You're reading it now!
    -v --version    Version! This one: 0.4.0!
    -e --eval       Evaluate the script
    -p --print      Evaluate the script and print the result
       --force-esm  Force transpilation of ".ts" files to EcmaScript modules
       --force-cjs  Force transpilation of ".ts" files to CommonJS modules
```
