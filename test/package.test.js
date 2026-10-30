import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('bundle patch is published', () => {
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  const output = process.platform === 'win32'
    ? execFileSync(process.env.ComSpec, ['/d', '/s', '/c', 'npm pack --dry-run --json'])
    : execFileSync('npm', ['pack', '--dry-run', '--json'])
  const [packed] = JSON.parse(output.toString())
  assert.ok(packed.files.some(({ path }) => path === 'cordis.patch.yml'))
})

test('runtime imports are declared as peer dependencies', () => {
  assert.equal(manifest.peerDependencies['@deepseek-ai/schemastery'], '*')
})
