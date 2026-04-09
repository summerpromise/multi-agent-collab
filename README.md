# 多智能体协作系统（Multi-Agent Collaboration System）

> 基于大语言模型的多智能体协作 RPG 游戏框架 —— SillyTavern 扩展插件

[![Version](https://img.shields.io/badge/version-5.3.0-gold)]()
[![Platform](https://img.shields.io/badge/platform-SillyTavern-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## 项目简介

本项目是一个运行在 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 平台上的第三方扩展插件，实现了基于大语言模型（LLM）的多智能体协作系统。系统以文字 RPG 游戏为应用场景，多个 AI Agent 在共享的虚拟世界中自主决策、协作冒险，由 LLM 驱动的 GM（游戏主持人）Agent 动态推进剧情。

**核心特性：**

- **双模式 LLM 交互**：支持 OpenAI Function Calling（结构化工具调用）和 ReAct（推理-行动文本解析）两种模式
- **多智能体协调**：多个 NPC Agent 按优先级轮转执行，具备跨轮上下文记忆和事件广播
- **LLM GM Agent**：由大语言模型驱动的游戏主持人，动态生成剧情事件、控制敌人刷新、维持游戏平衡
- **数据驱动战斗**：基于角色属性表（ATK/DEF/Bonuses）计算伤害，不硬编码职业
- **全屏仪表盘 UI**：7 页仪表盘（总览/游戏/智能体/世界/评估/设置/日志），黑金 Glassmorphism 风格
- **浮动 HUD + 酒馆聊天注入**：在 SillyTavern 主聊天界面叠加 HUD 和消息气泡
- **自动化评估**：内置性能指标收集和自动测试功能
- **存档系统**：支持 3 个存档槽位，保存/加载完整游戏状态

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                    用户界面层 (PART 8)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │全屏仪表盘 │  │ 浮动HUD  │  │酒馆聊天注入│  │Mini HUD │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │
│       └──────────────┴─────────────┴─────────────┘       │
├──────────────────────────────────────────────────────────┤
│                    协调层 (PART 6)                        │
│          gameLoop: 用户行动 → NPC轮转 → GM回合            │
├──────────────────────────────────────────────────────────┤
│                  Agent 执行引擎 (PART 5)                  │
│  ┌─────────────────┐      ┌─────────────────┐           │
│  │  runTurnFC()    │      │  runTurnReAct() │           │
│  │  Function Call  │      │  THOUGHT/ACTION │           │
│  └────────┬────────┘      └────────┬────────┘           │
│           └────────────┬───────────┘                     │
├────────────────────────┼─────────────────────────────────┤
│                   LLM 层 (PART 4)                        │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐            │
│  │ callLLM  │  │ callLLMFC │  │ callTO     │            │
│  │ 文本模式  │  │ FC模式    │  │ 超时控制    │            │
│  └──────────┘  └───────────┘  └────────────┘            │
│         ↕                ↕                               │
│  ┌─────────────────────────────────────┐                 │
│  │  OpenAI API / SillyTavern generateRaw                │
│  └─────────────────────────────────────┘                 │
├──────────────────────────────────────────────────────────┤
│                  游戏引擎 (PART 3)                        │
│  executeTool() · calcDamage() · broadcastEvent()         │
│  resolveId() · resolveParams() · executeGMTool()         │
├──────────────────────────────────────────────────────────┤
│                  数据层 (PART 0-2)                        │
│  场景模板 · 全局状态G · 配置持久化 · 存档系统              │
└──────────────────────────────────────────────────────────┘
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行平台 | SillyTavern（Node.js + 浏览器客户端） |
| 编程语言 | JavaScript (ES2020+)、CSS3、HTML5 |
| LLM 接口 | OpenAI Chat Completions API（兼容 GPT-4/GPT-4o-mini/Claude 等） |
| AI 算法 | ReAct（Reasoning and Acting）、Function Calling（工具调用） |
| UI 框架 | 原生 DOM 操作，Glassmorphism 设计风格 |
| 状态管理 | SillyTavern extensionSettings + localStorage |
| 网络请求 | Fetch API + AbortController |
| 启动检测 | MutationObserver + SillyTavern 事件系统 |

## 安装部署

### 前置要求

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.0.0 或更高版本
- OpenAI 兼容的 API 服务（用于 Function Calling 模式）或 SillyTavern 已配置的 LLM 后端（用于 ReAct 模式）

### 安装步骤

1. **下载扩展**

   ```bash
   cd <SillyTavern安装目录>/data/default-user/extensions/
   git clone https://github.com/summerpromise/multi-agent-collab.git
   ```

2. **启动 SillyTavern**

   启动 SillyTavern 后，扩展将自动加载。顶部栏会出现六边形图标按钮。

3. **配置 API**

   点击六边形图标打开全屏面板 → 进入「设置」页 → 填写 API 地址、Key 和模型名称。

## 使用说明

### 快速开始

1. 点击顶栏六边形图标，打开多智能体系统面板
2. 在「仪表盘」页点击 **初始化** 按钮
3. 点击 **开始**，系统进入游戏循环
4. 在输入框中输入你的行动（如"前往森林"、"攻击灰狼"、"搜索"）
5. 观察 NPC Agent 的自主决策和 GM 的剧情推进

### 支持的玩家指令

| 指令格式 | 示例 |
|----------|------|
| `前往/去/到 + 地点` | 前往森林、去地牢入口 |
| `攻击/打/砍 + 目标` | 攻击灰狼、打骷髅 |
| `拾取/拿/捡 + 物品` | 拾取魔法剑 |
| `使用/吃/喝 + 物品` | 使用治疗药水 |
| `对X说 + 内容` | 对战士阿强说：一起去地牢 |
| `搜索/探索` | 搜索 |
| `休息` | 休息 |
| 自然语言 | 我想看看周围有什么（由 LLM 自动解析） |

### 页面说明

- **仪表盘**：总览面板，显示回合数、LLM 调用次数、角色状态卡片、近期行动
- **游戏**：主聊天区，显示所有游戏消息（思考气泡、行动结果、系统通知）
- **智能体**：NPC Agent 配置编辑器（名称、角色、ATK/DEF、提示词）
- **世界**：场景选择、世界模板 JSON 编辑、World Info 集成
- **评估**：性能指标仪表盘、自动测试工具
- **设置**：API 配置、游戏参数、玩家信息、Prompt 模板、存档管理
- **日志**：底层运行日志（API 请求/响应、工具执行、状态变更）

## 文件结构

```
multi-agent-collab/
├── manifest.json    # SillyTavern 扩展清单（名称、版本、入口文件）
├── index.js         # 核心逻辑（~1500行，含完整 JSDoc 注释）
├── style.css        # UI 样式（黑金 Glassmorphism 主题）
└── README.md        # 项目说明文档
```

## 核心算法

### ReAct 模式（文本推理）

```
输入: 系统提示词 + 游戏状态 + 历史行动
  ↓
LLM 生成:
  THOUGHT: [角色的思考过程]
  ACTION: {"tool":"attack","params":{"target":"wolf"}}
  ↓
正则解析 THOUGHT/ACTION → 执行工具 → 观察结果 → 循环
```

### Function Calling 模式

```
输入: system message + user message(游戏状态) + tools 定义
  ↓
LLM 返回:
  content: "前方有敌人，我决定进攻！"  (思考内容)
  tool_calls: [{name:"attack", arguments:{"target":"wolf"}}]
  ↓
解析 tool_calls → 执行工具 → 将结果作为 tool message 回传 → 循环
```

## 作者

**胡适麒** (f22016405)

## 许可证

MIT License
