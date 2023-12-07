#!/bin/bash -e

BASE="${PWD}/test/test"

_cleanup() {
  RV="$?"
  test "${RV}" -eq 0 \
    && echo -e '\033[38;5;76m*\033[0m Test Success' \
    || echo -e '\033[38;5;203m*\033[0m Test Failed'
  exit "${RV}"
}

_run() {
  EXPECTED="$1"
  shift

  echo -e '  \033[38;5;240m*\033[0m' node ./dist/tsrun.mjs "${@}" > /dev/stderr
  ACTUAL="$(node ./dist/tsrun.mjs "${@}")"

  if test "${EXPECTED}" != "${ACTUAL}" ; then
    echo -e '    \033[38;5;203m*\033[0m Expected:' "${EXPECTED}"
    echo -e '    \033[38;5;203m*\033[0m   Actual:' "${ACTUAL}"
    return 1
  else
    return 0
  fi
}

trap "_cleanup" EXIT

FAIL=0

echo -e '\033[38;5;69m*\033[0m Testing with node' $(node -v)

echo -e '\033[38;5;69m*\033[0m Testing "ts" file...'
_run "file://${BASE}.ts" ./test/test.ts || FAIL=1
_run "file://${BASE}.ts" --force-esm ./test/test.ts || FAIL=1
_run "${BASE}.ts"        --force-cjs ./test/test.ts || FAIL=1

echo -e '\033[38;5;69m*\033[0m Testing "mts" file...'
_run "file://${BASE}.mts" ./test/test.mts || FAIL=1
_run "file://${BASE}.mts" --force-esm ./test/test.mts || FAIL=1
_run "file://${BASE}.mts" --force-cjs ./test/test.mts || FAIL=1

echo -e '\033[38;5;69m*\033[0m Testing "cts" file...'
_run "${BASE}.cts" ./test/test.cts || FAIL=1
_run "${BASE}.cts" --force-esm ./test/test.cts || FAIL=1
_run "${BASE}.cts" --force-cjs ./test/test.cts || FAIL=1

echo -e '\033[38;5;69m*\033[0m Testing forking scripts...'
_run "file://${BASE}.ts" ./test/forking.ts || FAIL=1
_run "file://${BASE}.ts" --force-esm ./test/forking.ts || FAIL=1
_run "${BASE}.ts"        --force-cjs ./test/forking.ts || FAIL=1

exit "${FAIL}"
