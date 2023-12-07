import { fork } from 'node:child_process'
import { createRequire } from 'node:module'

const forked = createRequire(__fileurl).resolve('./test.ts')

const child = fork(forked, {
  stdio: [ 'inherit', 'inherit', 'inherit', 'ipc' ],
})

/* Monitor child process... */
child.on('error', (error) => {
  console.log('Error in child process', error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`Child process exited with signal ${signal}`)
    process.exit(1)
  } else if (typeof code !== 'number') {
    console.log('Child process failed for an unknown reason')
    process.exit(1)
  } else {
    process.exit(code)
  }
})
