# NeMind 项目报告

## 项目概述

**NeMind** 是一个 AI 驱动的图谱思维工具。用户在左侧聊天框和 AI 对话，AI 理解意图后自动在右侧画布上生成/修改交互式节点图谱（基于 React Flow）。核心流程：

```
用户输入 → Next.js API → DeepSeek V4 → 结构化 JSON Patch → 自动应用到画布
```

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16.2 (App Router + Turbopack) |
| 前端 | React 19 + TypeScript 5 (strict) |
| 画布 | @xyflow/react 12.10 (React Flow) |
| 校验 | Zod 4.2 |
| AI | OpenAI 兼容格式 → DeepSeek V4 (deepseek-v4-flash/pro) |
| 持久化 | 三层：localStorage → IndexedDB → 服务端 JSON 文件 |
| 图标 | lucide-react 0.561 |

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── ai/
│   │   │   ├── chat/route.ts     # POST /api/ai/chat - AI 对话
│   │   │   └── models/route.ts   # POST /api/ai/models - 模型列表
│   │   └── documents/route.ts    # GET/POST/DELETE /api/documents
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                  # 入口 → NeMindApp
├── components/
│   └── NeMindApp.tsx             # 主组件 (~1400 行，单文件 SPA)
└── lib/
    ├── ai/
    │   ├── openai-compatible.ts  # API 客户端 + 多层 JSON 降级解析
    │   └── providers.ts          # 提供商工厂 (DeepSeek / Custom / Mock)
    ├── graph.ts                  # 图谱 CRUD + Patch 应用
    ├── importers.ts              # Markdown/Mermaid 文本导入
    ├── layout.ts                 # 自动布局算法 (flow/mindmap/architecture)
    ├── schema.ts                 # Zod 校验
    ├── server-documents.ts       # 服务端文件持久化
    ├── storage.ts                # 客户端三层持久化
    └── types.ts                  # TypeScript 类型定义
```

## 已实现功能

### 核心链路
- **自然语言输入**：Enter 发送，Shift+Enter 换行
- **DeepSeek V4 集成**：官方 API，自动获取模型列表
- **4 层 JSON 降级解析**：直接解析 → ```json 代码块 → ``` 任意代码块 → 正则兜底
- **自动应用到画布**：AI 返回 patch 后直接渲染，无需手动确认，支持撤销
- **Chat/Map 双模式**：
  - **Chat 模式**：纯对话，AI 不输出 graph patch，画布不变
  - **Map 模式**：对话 + 自动更新画布

### 画布交互
- **React Flow 交互图**：节点拖拽、连线、缩放、平移
- **框选**：左→右全包含，右→左触碰即选 (Figma 风格)
- **中键/右键平移**：框选占用左键后，平移切换到中右键
- **自动布局**：flow（从左到右）、mindmap（中心分叉）、architecture（大间距分层）
- **自动 fitView**：patch 应用后画布自动适配

### 节点类型
| 类型 | 用途 | 颜色建议 |
|---|---|---|
| process | 步骤/动作 | 蓝 |
| decision | 判断/分支 | 黄 |
| system | 组件/服务 | 紫 |
| concept | 概念/主题 | 绿 |
| note | 注释/补充 | 灰 |

### AI Patch 协议
AI 不直接操作画布，而是返回结构化操作序列：
```json
{
  "reply": "自然语言回复",
  "patch": {
    "summary": "变更摘要",
    "operations": [
      { "type": "addNode", "node": { "id": "n1", "data": { "title": "...", "kind": "process" } } },
      { "type": "addEdge", "edge": { "source": "n1", "target": "n2" } },
      { "type": "layoutGraph", "mode": "flow" }
    ]
  }
}
```
支持的 operation：addNode, updateNode, deleteNode, addEdge, updateEdge, deleteEdge, layoutGraph

### 模型管理
- **内置 DeepSeek V4**：V4 Flash / V4 Pro
- **自定义 OpenAI 兼容接口**：支持任意第三方 API
- **一键连接**：粘贴 NewAPI JSON 配置 → 自动获取模型 → 自动连接，无需手动填表
- **持久化**：自定义模型存 localStorage，跨会话保留
- **思考强度**：auto/low/medium/high/max

### 项目管理
- **多画布**：新建/切换/重命名
- **回收站**：软删除（30 天自动清理），支持恢复和彻底删除
- **编辑日期**：相对时间显示（"3 分钟前" → "2 天前" → 具体日期）
- **导出/导入**：JSON 格式
- **撤销/重做**：每次 patch 应用前自动记录
- **自动保存**：350ms 防抖，三层持久化

### 文本导入
- Markdown 列表 → mindmap 树形结构
- Mermaid flowchart → process 流程节点

## 关键设计决策

1. **Patch 协议而非直写**：AI 不直接改状态，返回操作序列。用户拥有最终控制权（虽然现已自动 apply，但 undo 仍可用）
2. **单文件组件**：NeMindApp.tsx 包含全部 UI 逻辑，不拆分子组件（快速迭代优先）
3. **无数据库**：服务端用 `.nemind-data/documents.json` 单文件存储，适合单用户场景
4. **本地优先**：localStorage 同步写 → IndexedDB 后台写 → 服务端异步写，离线可用
5. **模型响应规范化**：`normalizeModelPatch()` (~120 行) 处理各种 LLM 输出差异（nodeId/id 别名、嵌套/扁平结构等）

## 环境配置

`.env.local`:
```
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-flash
NEXT_PUBLIC_DEPSB_KEY=sk-xxx  # 自定义 API 种子配置
```

## 当前状态

- 完整链路已打通：聊天 → AI → 画布
- Dev server: `npm run dev` → `localhost:3000`
- Chat/Map 模式可切换
- 框选 + 聚焦问答可用
- 回收站、编辑日期、项目切换等功能完整

## 下一步方向（待定）

1. **AI 导图结构引导**：让 AI 按 "问题 → 判断 → 动作" 三层输出
2. **行动卡导出**：将导图压缩为结构化行动卡片
3. **节点颜色/样式模板**：按类型自动配色
4. **导图分类/标签**：项目管理维度
5. **流式响应**：AI 回复 token-by-token 显示
