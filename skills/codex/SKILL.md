---
name: codex
description: "Use when the user wants to invoke the locally installed Codex CLI (OpenAI Codex) through the dsh agent: run a one-shot codex task, get an independent code review, ask for a second opinion from another model, or resume a previous codex session. Triggers: 'codex 跑一下', '用 codex 审查', 'let codex review', 'ask codex', 'second opinion', 'resume codex session', '对比 codex 的输出'. Drives the codex_* tools instead of raw shell calls."
---

# Codex：通过 dsh 调用本地 Codex CLI

本技能用 dsh-codex 插件暴露的 `codex_*` 工具驱动本机安装的 Codex CLI（`codex exec`
非交互模式）。Codex 走 `~/.codex/config.toml` 里配置的提供方（本机为 DeepSeek，
**无需 OpenAI 登录**），每次调用消耗该提供方的 token 额度。

## 什么时候用

- 用户明确要求调用 Codex / 让 codex 执行任务 / 用 codex 做独立审查
- 需要"第二意见"：同一个任务让 codex 独立做一遍，再与当前结果对比
- 续接之前的 codex 会话（`codex_resume`）
- 用户说"codex 集成 / codex 适配 / 像 skillopt 那样调 codex"之类的话

优先使用 `codex_*` 工具，而不是手工拼 `codex` 命令。

## 工具速查

| 工具 | 行为 |
|---|---|
| `codex_status` | CLI 可用性、版本、配置路径与提供方（密钥打码，不显示） |
| `codex_exec` | 一次性任务：给自包含提示词，codex 在指定目录里干活 |
| `codex_review` | 对当前仓库 / 指定 diff / commit 做代码审查（只读性质） |
| `codex_resume` | 按 session id 或 `last=true` 续接之前的会话并追加提示词 |

典型用法：

```text
# 1. 先确认 CLI 可用
codex_status

# 2. 一次性任务（默认只读沙箱，安全）
codex_exec prompt="审查 F:\8.15.6\src\app.ts，找出 bug 与优化点，输出中文报告" cd="F:\8.15.6"

# 3. 需要它改文件时，显式升级沙箱
codex_exec prompt="给 src/ 下的模块补单元测试并跑通" cd="F:\8.15.6" sandbox=workspace-write

# 4. 独立代码审查（只读）
codex_review uncommitted=true cd 所在仓库目录由会话工作目录决定

# 5. 续接上一次会话
codex_resume last=true prompt="继续完成剩余部分"
```

## 硬性规则

- **默认只读**：`codex_exec` 的沙箱默认 `read-only`。只有任务确实要写文件时才显式传
  `sandbox=workspace-write`；`danger-full-access` 极其危险，仅在外层已有隔离时使用。
- **提示词必须自包含**：codex 看不到 dsh 会话上下文，路径、约束、期望输出要写全。
- **绝不把密钥/令牌放进提示词**，也不要让 codex 去读 `.env` / `auth.json` 等凭据文件。
- **注意用量**：codex 与当前会话共用 DeepSeek 额度；大批量任务先小样本验证。
- 需要输出到文件（供后续读取/对比）时传 `outputFile=<路径>`，工具结果里会回显最终消息。
- 会话默认持久化（`ephemeral=false`），所以 `codex_resume` 可用；不需要留痕时传 `ephemeral=true`。

## 配置（cordis.yml / bundle patch）

```yaml
- insert:
    - id: codex
      name: './src/index.js'
      config:
        model: deepseek-v4-flash   # 空 = 用 ~/.codex/config.toml
        sandbox: read-only
        cd: /path/to/workspace
```

## 验证

```bash
codex --version          # CLI 可用
codex_status             # 插件链路 OK（不消耗模型额度）
codex_exec prompt="Reply with exactly: OK"   # 最小冒烟（消耗少量额度）
```
