// dsh-codex — OpenAI Codex CLI integration for DeepSeek Harness.
//
// Exposes the locally installed `codex` CLI to the dsh agent as native tools:
// status, one-shot exec, repo review and session resume. All calls run through
// the dsh shell executor in non-interactive mode (`codex exec ...`). Default
// sandbox is read-only; escalate per call or via config only when the task
// actually needs to write files. Codex talks to whatever provider is
// configured in ~/.codex/config.toml (e.g. DeepSeek), no OpenAI login needed.

import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runShell } from './shell.js'

export const name = 'codex'

// Wait for the tool registry and the shell executor before applying.
export const inject = ['tools', 'shell']

// ---------------------------------------------------------------------------
// Config (Schemastery)
// ---------------------------------------------------------------------------

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access']
const COLOR_MODES = ['auto', 'always', 'never']

export const Config = Schema.object({
  codexPath: Schema.string()
    .default('codex')
    .description('Path to the codex CLI (default: codex on PATH)'),
  model: Schema.string()
    .description('Default model override (e.g. deepseek-v4-flash); empty = use ~/.codex/config.toml'),
  sandbox: Schema.union(SANDBOX_MODES)
    .default('read-only')
    .description('Default sandbox policy for model-generated shell commands'),
  cd: Schema.string()
    .description('Default working root for codex sessions (working directory)'),
  profile: Schema.string()
    .description('Config profile to layer ($CODEX_HOME/<name>.config.toml)'),
  skipGitRepoCheck: Schema.boolean()
    .default(true)
    .description('Pass --skip-git-repo-check (dsh workdirs are often not git repos)'),
  ephemeral: Schema.boolean()
    .default(false)
    .description('Do not persist session files (disables resume)'),
  json: Schema.boolean()
    .default(false)
    .description('Emit codex events as JSONL instead of plain text'),
  approveForMe: Schema.boolean()
    .default(false)
    .description('Route approval requests through automatic review (workspace-write)'),
  color: Schema.union(COLOR_MODES)
    .default('never')
    .description('ANSI color mode for codex output'),
  timeoutMs: Schema.number()
    .default(600_000)
    .description('Per-call timeout in milliseconds (default 10 min)'),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Quote one argument for the shell (works for both PowerShell and bash):
// single quotes are literal in both, embedded quotes are doubled.
function q(value) {
  if (value === undefined || value === null || value === '') return ''
  return `'${String(value).replace(/'/g, "''")}'`
}

function pushOpt(parts, flag, value) {
  const v = q(value)
  if (v) parts.push(flag, v)
}

function boolFlag(parts, flag, value) {
  if (value) parts.push(flag)
}

// Shared flags present on every `codex exec` subcommand.
function pushCommonFlags(parts, config, a, { withSandbox = false } = {}) {
  pushOpt(parts, '-m', a.model ?? config.model)
  pushOpt(parts, '-p', a.profile ?? config.profile)
  if (withSandbox) pushOpt(parts, '-s', a.sandbox ?? config.sandbox)
  boolFlag(parts, '--skip-git-repo-check', a.skipGitRepoCheck ?? config.skipGitRepoCheck)
  boolFlag(parts, '--ephemeral', a.ephemeral ?? config.ephemeral)
  boolFlag(parts, '--json', a.json ?? config.json)
  pushOpt(parts, '-o', a.outputFile)
  pushOpt(parts, '-c', a.configOverride)
}

// `codex exec` — one-shot task (richest flag set: cd, sandbox, images, add-dir).
function buildExec(config, a) {
  const parts = [config.codexPath || 'codex', 'exec']
  pushOpt(parts, '-C', a.cd ?? config.cd)
  pushOpt(parts, '-i', a.image)
  pushOpt(parts, '--add-dir', a.addDir)
  pushCommonFlags(parts, config, a, { withSandbox: true })
  boolFlag(parts, '--approve-for-me', a.approveForMe ?? config.approveForMe)
  const color = a.color ?? config.color
  if (color) parts.push('--color', color)
  if (a.prompt) parts.push(q(a.prompt))
  return parts.join(' ')
}

// `codex exec review` — review the current repo / a diff (no cd / sandbox flags).
function buildReview(config, a) {
  const parts = [config.codexPath || 'codex', 'exec', 'review']
  boolFlag(parts, '--uncommitted', a.uncommitted)
  pushOpt(parts, '--base', a.base)
  pushOpt(parts, '--commit', a.commit)
  pushOpt(parts, '--title', a.title)
  pushCommonFlags(parts, config, a)
  if (a.prompt) parts.push(q(a.prompt))
  return parts.join(' ')
}

// `codex exec resume` — continue a previous session (no cd / sandbox flags).
function buildResume(config, a) {
  const parts = [config.codexPath || 'codex', 'exec', 'resume']
  if (a.last) parts.push('--last')
  boolFlag(parts, '--all', a.all)
  pushOpt(parts, '-i', a.image)
  pushCommonFlags(parts, config, a)
  if (a.sessionId) parts.push(q(a.sessionId))
  if (a.prompt) parts.push(q(a.prompt))
  return parts.join(' ')
}

function renderOutput(_args, value) {
  return [{ type: 'text', text: value }]
}

// Masked peek at ~/.codex/config.toml: print only provider/model lines and
// never anything inside an [auth] section (no keys).
function maskedConfigSummary(text) {
  const out = []
  let inAuth = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inAuth = /^\[auth\]/i.test(line)
      continue
    }
    if (inAuth || !line || line.startsWith('#')) continue
    const m = line.match(/^(model_provider|base_url|model|temperature|approval_policy|sandbox_mode)\s*=\s*(.+)$/i)
    if (m) out.push(`${m[1]}=${m[2].replace(/^["']|["']$/g, '')}`)
  }
  return out.join(' | ')
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const shell = ctx.shell

  const tools = [
    {
      name: 'codex_status',
      description:
        'Show Codex CLI availability (version), the config file location and the active provider/model (auth keys are masked, never shown).',
      parameters: {},
      build: () => `${config.codexPath || 'codex'} --version`,
    },
    {
      name: 'codex_exec',
      description:
        'Run a one-shot Codex task in the given directory: the agent gets the prompt and may use tools to inspect and edit files. Default sandbox is read-only; use workspace-write / danger-full-access only when the task must write files. Consumes the provider quota configured for codex (e.g. DeepSeek tokens).',
      parameters: {
        prompt: { type: 'string', description: 'Self-contained task description (codex sees no dsh context — spell out paths and constraints)', required: true },
        cd: { type: 'string', description: 'Working root for the session (default: config.cd or the dsh session workdir)' },
        sandbox: { type: 'string', enum: SANDBOX_MODES, description: 'Sandbox policy for model-generated commands' },
        model: { type: 'string', description: 'Model override (default: config.model or ~/.codex/config.toml)' },
        profile: { type: 'string', description: 'Config profile to layer' },
        image: { type: 'string', description: 'Image file to attach to the initial prompt' },
        addDir: { type: 'string', description: 'Extra directory that should be writable alongside the primary workspace' },
        approveForMe: { type: 'boolean', description: 'Route approvals through automatic review (implies a writable sandbox)' },
        skipGitRepoCheck: { type: 'boolean', description: 'Allow running outside a git repository' },
        ephemeral: { type: 'boolean', description: 'Do not persist session files' },
        json: { type: 'boolean', description: 'Emit codex events as JSONL' },
        color: { type: 'string', enum: COLOR_MODES, description: 'ANSI color mode' },
        outputFile: { type: 'string', description: 'Write the agent final message to this file (also echoed in the tool result)' },
        configOverride: { type: 'string', description: 'One -c dotted key=value config override (e.g. model="gpt-5")' },
      },
      build: (a) => buildExec(config, a),
    },
    {
      name: 'codex_review',
      description:
        'Run a Codex code review against the current repository (or a specific diff/commit). Read-only by nature; the review instructions and findings come back as text. Consumes provider quota.',
      parameters: {
        prompt: { type: 'string', description: 'Custom review instructions' },
        uncommitted: { type: 'boolean', description: 'Review staged, unstaged and untracked changes' },
        base: { type: 'string', description: 'Review changes against the given base branch' },
        commit: { type: 'string', description: 'Review the changes introduced by a commit SHA' },
        title: { type: 'string', description: 'Optional commit title to display in the review summary' },
        model: { type: 'string', description: 'Model override' },
        skipGitRepoCheck: { type: 'boolean', description: 'Allow running outside a git repository' },
        ephemeral: { type: 'boolean', description: 'Do not persist session files' },
        json: { type: 'boolean', description: 'Emit codex events as JSONL' },
        outputFile: { type: 'string', description: 'Write the review final message to this file (also echoed in the tool result)' },
        configOverride: { type: 'string', description: 'One -c dotted key=value config override' },
      },
      build: (a) => buildReview(config, a),
    },
    {
      name: 'codex_resume',
      description:
        'Resume a previous codex session by id (or the most recent with last=true) and optionally send a follow-up prompt. Requires sessions to have been persisted (ephemeral=false).',
      parameters: {
        sessionId: { type: 'string', description: 'Session id (UUID) or thread name to resume' },
        last: { type: 'boolean', description: 'Resume the most recent recorded session instead of an id' },
        all: { type: 'boolean', description: 'Show all sessions (disables cwd filtering)' },
        prompt: { type: 'string', description: 'Follow-up prompt to send after resuming' },
        image: { type: 'string', description: 'Image to attach to the follow-up prompt' },
        model: { type: 'string', description: 'Model override' },
        skipGitRepoCheck: { type: 'boolean', description: 'Allow running outside a git repository' },
        ephemeral: { type: 'boolean', description: 'Do not persist session files' },
        json: { type: 'boolean', description: 'Emit codex events as JSONL' },
        outputFile: { type: 'string', description: 'Write the agent final message to this file (also echoed in the tool result)' },
        configOverride: { type: 'string', description: 'One -c dotted key=value config override' },
      },
      build: (a) => buildResume(config, a),
    },
  ]

  for (const t of tools) {
    ctx.tools.register(
      defineTool({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        output: { schema: { type: 'string' }, render: renderOutput },
        async execute(args, exec) {
          if (t.name === 'codex_status') {
            return statusBody(config, shell, exec)
          }
          const command = t.build(args || {})
          try {
            const result = await runShell(shell, {
              command,
              timeoutMs: config.timeoutMs,
              signal: exec?.signal,
            })
            const status = result?.exitCode ?? 'signal'
            const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
            const stderr = typeof result?.stderr === 'string' ? result.stderr : ''
            const tail = [stdout, stderr].filter(Boolean).join('\n').trim()
            let text = `[codex ${t.name}] exit=${status}`
            if (tail) text += '\n' + tail.slice(0, 60_000)
            const finalText = readOutputFile(args?.outputFile)
            if (finalText) text += '\n\n--- final message ---\n' + finalText
            return text
          } catch (err) {
            return `[codex ${t.name}] command failed: ${err?.message || String(err)}`
          }
        },
      }),
    )
  }

  ctx.logger?.info?.('[dsh-codex] registered 4 codex tools (status/exec/review/resume)')
}

// ---------------------------------------------------------------------------
// status implementation (version + masked config, never any secrets)
// ---------------------------------------------------------------------------

async function statusBody(config, shell, exec) {
  const codex = config.codexPath || 'codex'
  const lines = []
  try {
    const v = await runShell(shell, { command: `${codex} --version`, timeoutMs: config.timeoutMs, signal: exec?.signal })
    const version = String(v?.stdout ?? '').trim()
    lines.push(version ? `codex CLI: ${version}` : `codex CLI: exit=${v?.exitCode ?? '?'}`)
  } catch (err) {
    lines.push(`codex CLI: unavailable (${err?.message || String(err)})`)
  }
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  const cfgPath = join(codexHome, 'config.toml')
  if (existsSync(cfgPath)) {
    lines.push(`config: ${cfgPath}`)
    try {
      const summary = maskedConfigSummary(readFileSync(cfgPath, 'utf8'))
      if (summary) lines.push(`provider: ${summary}`)
    } catch {
      lines.push('provider: (config unreadable)')
    }
  } else {
    lines.push(`config: not found (${cfgPath})`)
  }
  return lines.join('\n')
}

function readOutputFile(file) {
  if (!file || !existsSync(file)) return ''
  try {
    const text = readFileSync(file, 'utf8').trim()
    return text ? text.slice(0, 60_000) : ''
  } catch {
    return ''
  }
}
