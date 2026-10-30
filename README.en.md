# dsh-codex

**OpenAI Codex CLI integration for DeepSeek Harness (dsh)** — exposes your
locally installed Codex CLI to the dsh agent as **native tools**: one-shot
tasks, repository code reviews and session resumes, all via non-interactive
`codex exec` with a **read-only sandbox by default**. Codex talks to whatever
provider is configured in `~/.codex/config.toml` (on this machine: DeepSeek —
**no OpenAI login required**) and shares the same provider quota as this session.

> Independent community project, not official. The CLI itself comes from
> [OpenAI Codex](https://github.com/openai/codex) (Apache-2.0); this plugin only
> wires `codex exec` into dsh's tool/skill system, following the same adapter
> style as `dsh-skillopt` (Schemastery config + `defineTool` + shell executor +
> `SKILL.md` + bundle patch layer).

## Features

- 4 native dsh tools: `codex_status` / `codex_exec` / `codex_review` / `codex_resume`
- Bundled `SKILL.md` teaching the agent when and how to use them
- Schemastery config (model / sandbox / cd / profile / timeoutMs …)
- Bundle patch layer (`cordis.patch.yml`) — drop into any profile
- Default `read-only` sandbox; writing files requires an explicit
  `workspace-write` / `danger-full-access` escalation
- Sessions are persisted by default, so `codex_resume` works; `outputFile`
  echoes the agent's final message back into the tool result
- `codex_status` prints a masked provider summary — never any credentials

## Prerequisites

- DeepSeek Harness (dsh) installed
- Codex CLI:

```bash
npm install -g @openai/codex
codex --version
```

- A provider configured in `~/.codex/config.toml` (e.g. DeepSeek:
  `model_provider`, `base_url`, `model`) or `codex login`. The plugin never
  reads or displays credentials.

## Install

### As a bundle in a profile

Add `dsh-codex` to the profile's bundles, or in the profile `cordis.patch.yml`:

```yaml
- insert:
    - id: codex
      name: 'dsh-codex'
      config:
        model: deepseek-v4-flash   # empty = use ~/.codex/config.toml
        sandbox: read-only         # read-only | workspace-write | danger-full-access
        cd: /path/to/workspace
```

### Local patch for development

```bash
pnpm dsh web --patch ./dsh-codex/cordis.patch.yml
```

Then ask the agent: "use codex_status to check the Codex setup".

## Troubleshooting

- If the plugin is not running and the log reports `Cannot find package
  '@deepseek-ai/schemastery'`, use `dsh-codex >= 0.1.1`. Older versions did not
  declare that peer dependency, so DSH 0.2 cannot route its built-in package to
  the plugin.
- A profile-level `cordis.patch.yml` must use `name: 'dsh-codex'`.
  `./src/index.js` is only for the plugin's own bundle patch or local development.
- Restart DSH after changing the plugin's `package.json` or peer dependencies;
  HMR does not reload that metadata.

## Usage

| Tool | Behavior |
|---|---|
| `codex_status` | CLI version, config path, masked provider summary |
| `codex_exec` | One-shot task: self-contained prompt + directory + sandbox level |
| `codex_review` | Code review of the repo / a diff / a commit (read-only by nature) |
| `codex_resume` | Resume a session by id or with `last=true` |

Typical flow:

```text
codex_status
codex_exec prompt="Review F:\8.15.6\src\app.ts and report bugs and optimizations" cd="F:\8.15.6"
codex_review uncommitted=true
codex_resume last=true prompt="Finish the remaining work"
```

## Config (Schemastery)

| Key | Default | Description |
|---|---|---|
| `codexPath` | `codex` | Path to the codex CLI |
| `model` | — | Default model override (empty = config.toml) |
| `sandbox` | `read-only` | `read-only\|workspace-write\|danger-full-access` |
| `cd` | — | Default working root |
| `profile` | — | Config profile to layer |
| `skipGitRepoCheck` | `true` | Always pass `--skip-git-repo-check` |
| `ephemeral` | `false` | Persist sessions (needed for resume) |
| `json` | `false` | JSONL event output |
| `approveForMe` | `false` | Automatic approval review (needs a writable sandbox) |
| `color` | `never` | `auto\|always\|never` |
| `timeoutMs` | `600000` | Per-call timeout (default 10 min) |

## Data boundaries & safety

- Default `read-only`: codex may inspect but not modify files; escalation is
  explicit per call.
- `codex_status` masks the provider config — nothing from the `[auth]` section
  is ever printed.
- Every `codex_exec` / `codex_review` sends your prompt and repository excerpts
  to the configured provider and spends its quota — validate on a small sample
  before large batches.
- Session files are written to disk (`~/.codex/sessions`) by default; use
  `ephemeral=true` when you don't want traces.

## Verification (minimal smoke)

```bash
codex --version
codex_status                                  # no model spend
codex_exec prompt="Reply with exactly: OK"    # tiny spend
```

## Directory layout

```
dsh-codex/
  src/index.js            # plugin entry: 4 tools + Schemastery config
  skills/codex/SKILL.md
  docs/                   # Chinese & English docs
  cordis.patch.yml        # bundle patch layer
```

## License

MIT. The CLI itself is copyright OpenAI Codex (Apache-2.0).
