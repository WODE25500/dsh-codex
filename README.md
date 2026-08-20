# dsh-codex

**OpenAI Codex CLI 的 DeepSeek Harness (dsh) 插件** —— 把本机安装的 Codex CLI 以
**原生 dsh 工具**的方式接入智能体：一次性任务、仓库代码审查、会话续接，全部走
`codex exec` 非交互模式，默认 `read-only` 沙箱。Codex 使用 `~/.codex/config.toml`
里配置的提供方（本机为 DeepSeek，**无需 OpenAI 登录**），与当前会话共用 DeepSeek 额度。

> 独立社区项目，非官方。CLI 本体来自 [OpenAI Codex](https://github.com/openai/codex)
> （Apache-2.0 / MIT），本插件只负责把它的 `codex exec` 接入 dsh 的工具/技能体系，
> 适配方式与 `dsh-skillopt` 一致（Schemastery 配置 + `defineTool` + shell 执行器 +
> `SKILL.md` + bundle patch 层）。

## 特性

- 4 个原生 dsh 工具：`codex_status` / `codex_exec` / `codex_review` / `codex_resume`
- 附带 `SKILL.md` 技能文件，指导 agent 何时、如何使用
- Schemastery 配置（model / sandbox / cd / profile / timeoutMs …）
- bundle patch 层（`cordis.patch.yml`），可一键加入任意 profile
- 默认 `read-only` 沙箱；写文件需显式升级 `workspace-write` / `danger-full-access`
- 会话默认持久化，支持 `codex_resume` 续接；`outputFile` 回显最终消息
- `codex_status` 打码显示提供方配置，绝不展示密钥

## 前置要求

- DeepSeek Harness（dsh）已安装
- Codex CLI：

```bash
npm install -g @openai/codex
codex --version
```

- `~/.codex/config.toml` 已配置提供方（如 DeepSeek：`model_provider`、`base_url`、
  `model`），或使用 `codex login` 登录。插件不读取也不展示任何凭据。

## 安装

### 方式一：作为 bundle 加入 profile

把 `dsh-codex` 加入 profile 的 bundles，或在 profile 的 `cordis.patch.yml` 中：

```yaml
- insert:
    - id: codex
      name: './src/index.js'
      config:
        model: deepseek-v4-flash   # 空 = 用 ~/.codex/config.toml
        sandbox: read-only         # read-only | workspace-write | danger-full-access
        cd: /path/to/workspace
```

### 方式二：本地 patch 临时加载（开发时）

```bash
# 在 dsh 仓库检出根目录，用 patch 覆盖加载
pnpm dsh web --patch ./dsh-codex/cordis.patch.yml
```

启动后向 agent 提问："用 codex_status 看一下 Codex 状态"。

## 用法

| 工具 | 行为 |
|---|---|
| `codex_status` | CLI 版本、配置路径、提供方摘要（密钥打码） |
| `codex_exec` | 一次性任务：自包含提示词 + 目录 + 沙箱级别 |
| `codex_review` | 仓库 / diff / commit 的代码审查（只读性质） |
| `codex_resume` | 按 session id 或 `last=true` 续接会话 |

典型流程：

```text
codex_status
codex_exec prompt="审查 F:\8.15.6\src\app.ts，找出 bug 与优化点" cd="F:\8.15.6"
codex_review uncommitted=true
codex_resume last=true prompt="继续完成剩余部分"
```

## 配置项（Schemastery）

| 键 | 默认 | 说明 |
|---|---|---|
| `codexPath` | `codex` | codex CLI 路径 |
| `model` | — | 默认模型覆盖（空 = 用 config.toml） |
| `sandbox` | `read-only` | 默认沙箱：`read-only\|workspace-write\|danger-full-access` |
| `cd` | — | 默认工作根目录 |
| `profile` | — | 叠加的配置 profile |
| `skipGitRepoCheck` | `true` | 默认加 `--skip-git-repo-check` |
| `ephemeral` | `false` | 默认持久化会话（resume 需要） |
| `json` | `false` | JSONL 事件输出 |
| `approveForMe` | `false` | 自动审阅批准（需可写沙箱） |
| `color` | `never` | ANSI 颜色：`auto\|always\|never` |
| `timeoutMs` | `600000` | 单次调用超时（默认 10 分钟） |

## 数据边界与安全

- 默认 `read-only`：codex 只能读，不能改文件；升级沙箱需显式传参。
- `codex_status` 打码提供方配置，绝不输出 `[auth]` 段内容。
- 每次 `codex_exec` / `codex_review` 都会把提示词与仓库内容片段发给配置的提供方，
  消耗其 token 额度——大任务先小样本验证。
- 会话文件默认写盘（`~/.codex/sessions`），不需要留痕时用 `ephemeral=true`。

## 验证（最小冒烟）

```bash
codex --version
codex_status                                  # 不消耗模型额度
codex_exec prompt="Reply with exactly: OK"    # 消耗少量额度
```

## 目录结构

```
dsh-codex/
  src/index.js            # 插件入口：4 个工具 + Schemastery 配置
  skills/codex/SKILL.md
  docs/                   # 中文与英文文档
  cordis.patch.yml        # bundle patch 层
```

## 许可

MIT。CLI 本体版权归 OpenAI Codex 项目（Apache-2.0）。
