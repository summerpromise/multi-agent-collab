# 多智能体协作系统（SillyTavern 扩展）

基于 SillyTavern 的多智能体文字 RPG：支持 Function Calling / ReAct、LLM GM、全屏仪表盘、浮动 HUD 与酒馆主聊天同步。

## 安装

将本仓库克隆或解压到 SillyTavern 的 `public/scripts/extensions/` 目录下，例如：

`public/scripts/extensions/multi-agent-collab/`

需包含 `manifest.json`、`index.js`、`style.css`。

## 配置要点

- **API**：在扩展设置中填写兼容 OpenAI Chat Completions 的地址与 Key；留空则使用酒馆内置 `generateRaw`（此时 Function Calling 不可用，将使用 ReAct 文本模式）。
- **世界模板**：在「世界」页编辑 JSON 后保存，**初始化**时会使用当前保存的世界数据（需包含 `locations`、`items`、`enemies`）。
- **消息显示**：设置 →「界面与消息」可选择仅全屏面板、仅酒馆主聊天或双通道，避免主聊天刷屏。
- **停止游戏**：会中止进行中的外部 API 请求（酒馆直连模式无法中断）。

## 仓库

https://github.com/summerpromise/multi-agent-collab

## 许可证

与作者毕设/项目说明一致；使用请遵守 SillyTavern 与各 API 提供商条款。
