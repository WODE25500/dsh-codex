import assert from 'node:assert/strict'
import test from 'node:test'
import { runShell } from '../src/shell.js'

const spec = { command: "'codex' '--version'", timeoutMs: 1000 }

test('dsh 0.2 uses execute() and awaits result()', async () => {
  const shell = {
    execute: async (received) => {
      assert.equal(received, spec)
      return { result: async () => ({ exitCode: 0, stdout: 'codex 1.0.0' }) }
    },
  }
  assert.deepEqual(await runShell(shell, spec), { exitCode: 0, stdout: 'codex 1.0.0' })
})

test('dsh 0.1 falls back to run()', async () => {
  const shell = {
    run: async (received) => {
      assert.equal(received, spec)
      return { exitCode: 0, stdout: 'codex 0.9.0' }
    },
  }
  assert.deepEqual(await runShell(shell, spec), { exitCode: 0, stdout: 'codex 0.9.0' })
})

test('execute() wins when both APIs are present', async () => {
  const shell = {
    execute: async () => ({ result: async () => ({ exitCode: 1 }) }),
    run: async () => ({ exitCode: 2 }),
  }
  assert.deepEqual(await runShell(shell, spec), { exitCode: 1 })
})
