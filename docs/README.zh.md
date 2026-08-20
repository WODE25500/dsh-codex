# dsh-codex 文档

## 快速上手

1. 安装 CLI：`npm install -g @openai/codex`，确认 `~/.codex/config.toml` 已配置提供方
   （本机为 DeepSeek，无需登录）。
2. 在 profile 的 `cordis.patch.yml` 插入插件（见根 README）。
3. 启动 dsh 后向 agent 提问："用 codex_status 看一下 Codex 状态"。

## 工具与 CLI 命令对照

| dsh 工具 | codex 命令 | 说明 |
|---|---|---|
| `codex_status` | `codex --version` + config 摘要 | 可用性与提供方（密钥打码） |
| `codex_exec` | `codex exec [flags] "prompt"` | 一次性任务，默认只读沙箱 |
| `codex_review` | `codex exec review [flags]` | 仓库 / diff / commit 审查 |
| `codex_resume` | `codex exec resume [id\|--last]` | 续接会话 |

## 沙箱升级示例

```text
codex_exec prompt="补测试并跑通" cd="F:\8.15.6" sandbox=workspace-write
```

`danger-full-access` 仅在外层已有隔离时使用。
