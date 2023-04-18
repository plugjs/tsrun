'use strict'

module.exports = {
  root: true,
  extends: [
    'plugin:@plugjs/typescript',
  ],
  parserOptions: {
    project: [
      './tsconfig.json',
    ],
  },
}
