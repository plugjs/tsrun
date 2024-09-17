#!/bin/bash -e

# Root ourselves in our project directory and figure out our version
cd "$(dirname "$0")"
PATH="${PATH}:${PWD}/node_modules/.bin"
VERSION="$(node -p 'require("./package.json").version')"

# Wipe the dist directory prior rebuilding
echo -e '\033[38;5;69m*\033[0m Removing "dist" directory...'
rm -rf "dist/"

# Check types and prepare our exported .d.ts
echo -e '\033[38;5;69m*\033[0m Checking and generating types...'
tsc -p "./tsconfig.json"
tsc -p "./tsconfig-tsd.json"

# Copy the "yargs-parser" types in our bundle
echo -e '\033[38;5;69m*\033[0m Incorporating "yargs-parser" types...'
cp "./node_modules/@types/yargs-parser/index.d.ts" "./dist/parser.d.mts"
sed -i '' 's|export = yargsParser|export default yargsParser|g' "./dist/parser.d.mts"

# Run ESLint on our sources
echo -e '\033[38;5;69m*\033[0m Linting sources...'
eslint 'src/**'

# Compile our "ts-loader" loader and CLI
echo -e '\033[38;5;69m*\033[0m Transpiling sources...'
esbuild \
	--platform=node \
	--format=esm \
	--target=node18 \
	--outdir=./dist \
	--out-extension:.js=.mjs \
	--external:esbuild \
	--define:__version="'${VERSION}'" \
	--sourcemap \
	--bundle \
		src/*.mts
esbuild \
	--platform=node \
	--format=cjs \
	--target=node18 \
	--outdir=./dist \
	--out-extension:.js=.cjs \
	--external:esbuild \
	--define:__version="'${VERSION}'" \
	--sourcemap \
	--bundle \
		src/*.cts

# Execute our minimal tests
exec cov8 -m 0 ./test.sh
