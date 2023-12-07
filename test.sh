#!/bin/bash -e

BASE="${PWD}/test/test"

_cleanup() {
  RV=$?
  test $RV -eq 0 \
    && echo -e '\033[38;5;76m*\033[0m Test Success' \
    || echo -e '\033[38;5;203m*\033[0m Test Failed'
  exit $RV
}

_run() {
  echo -e '\033[38;5;240m  *\033[0m' node "${@}" > /dev/stderr
  exec node "${@}"
}

trap "_cleanup" EXIT

echo -e '\033[38;5;69m*\033[0m Testing with node' $(node -v)

echo -e '\033[38;5;69m*\033[0m Testing "ts" file...'
test "$(_run ./dist/tsrun.mjs ./test/test.ts)" == "file://${BASE}.ts" || exit 1
test "$(_run ./dist/tsrun.mjs --force-esm ./test/test.ts)" == "file://${BASE}.ts" || exit 1
test "$(_run ./dist/tsrun.mjs --force-cjs ./test/test.ts)" == "${BASE}.ts" || exit 1

echo -e '\033[38;5;69m*\033[0m Testing "mts" file...'
test "$(_run ./dist/tsrun.mjs ./test/test.mts)" == "file://${BASE}.mts" || exit 1
test "$(_run ./dist/tsrun.mjs --force-esm ./test/test.mts)" == "file://${BASE}.mts" || exit 1
test "$(_run ./dist/tsrun.mjs --force-cjs ./test/test.mts)" == "file://${BASE}.mts" || exit 1

echo -e '\033[38;5;69m*\033[0m Testing "cts" file...'
test "$(_run ./dist/tsrun.mjs ./test/test.cts)" == "${BASE}.cts" || exit 1
test "$(_run ./dist/tsrun.mjs --force-esm ./test/test.cts)" == "${BASE}.cts" || exit 1
test "$(_run ./dist/tsrun.mjs --force-cjs ./test/test.cts)" == "${BASE}.cts" || exit 1

exit 0
