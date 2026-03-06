#!/usr/bin/env node

import { runCli } from './cli.js'

try {
  runCli(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
