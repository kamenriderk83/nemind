import {
  chatWithOpenAiCompatibleEndpoint,
  normalizeOpenAiBaseUrl,
} from "@/lib/ai/openai-compatible";
import type { AiChatRequest, AiChatResponse, GraphPatch } from "@/lib/types";

export interface AiProvider {
  chat(request: AiChatRequest): Promise<AiChatResponse>;
}

export function createProvider(id: string): AiProvider {
  if (id === "custom") return new OpenAiCompatibleProvider();
  if (id === "deepseek") return new DeepSeekProvider();
  return new MockProvider();
}

class MockProvider implements AiProvider {
  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const existing = new Set(request.document.nodes.map((node) => node.id));
    const nodeId = existing.has("mock-auth") ? `mock-${Date.now()}` : "mock-auth";
    const patch: GraphPatch = {
      summary: "Added a small login flow and arranged it as a left-to-right process.",
      operations: [
        {
          type: "addNode",
          node: {
            id: nodeId,
            data: {
              title: "User login",
              body: "Collect credentials and start the authentication flow.",
              kind: "concept",
              color: "#f8fafc",
            },
          },
        },
        {
          type: "addNode",
          node: {
            id: "mock-permission",
            data: {
              title: "Permission check",
              body: "Validate role, scope, and session state.",
              kind: "concept",
              color: "#f8fafc",
            },
          },
        },
        {
          type: "addEdge",
          edge: {
            source: nodeId,
            target: "mock-permission",
            label: "then",
          },
        },
        { type: "layoutGraph", mode: "flow" },
      ],
    };

    return {
      reply: `I drafted a graph change for: "${request.message}". Review the patch, then apply it when it looks right.`,
      patch,
    };
  }
}

class DeepSeekProvider implements AiProvider {
  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return {
        reply: "DeepSeek is configured, but DEEPSEEK_API_KEY is missing on the server.",
        error: "Missing DEEPSEEK_API_KEY",
      };
    }

    return chatWithOpenAiCompatibleEndpoint({
      apiKey,
      url: "https://api.deepseek.com/v1/chat/completions",
      model: request.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      request,
      providerName: "DeepSeek",
      systemPrompt: request.chatOnly ? chatOnlySystemPrompt : graphSystemPrompt,
    });
  }
}

class OpenAiCompatibleProvider implements AiProvider {
  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const config = request.customProvider;
    const apiKey = config?.apiKey?.trim();
    const model = request.model?.trim();
    const baseUrl = normalizeOpenAiBaseUrl(config?.baseUrl);

    if (!config || !baseUrl || !model) {
      return {
        reply: "自定义提供商还没有配置完整。请填写 Base URL 和模型 ID 后再发送。",
        error: "Custom provider is missing baseUrl or model.",
      };
    }

    if (!apiKey) {
      return {
        reply: "自定义提供商缺少 API Key。请在管理模型里补充密钥。",
        error: "Missing custom provider API key.",
      };
    }

    return chatWithOpenAiCompatibleEndpoint({
      apiKey,
      url: `${baseUrl}/chat/completions`,
      model,
      request,
      providerName: config.name,
      systemPrompt: request.chatOnly ? chatOnlySystemPrompt : graphSystemPrompt,
    });
  }
}

const graphSystemPrompt = `You are NeMind's graph copilot. Act like a sharp product/architecture thinking partner, not a generic diagram generator.

Core behavior:
- Read the current graph state first. Treat node IDs, titles, bodies, kinds, and edges as the source of truth.
- Infer intent from short commands. Examples: "整理" means reorganize the current graph; "继续" means add the next useful layer; "太乱了" means simplify and re-layout; "细一点" means add missing substeps; "不要这么多" means merge or delete weak nodes.
- Work line by line, not all at once. Each graph-changing reply should advance one coherent line of thought: one flow path, one mindmap branch, or one architecture slice.
- For a new empty map, create only the center/root and the first meaningful line. Do not generate the whole map in one response.
- For "继续/补充/展开/下一条线", add the next missing line or branch only. If nodes are focused, continue from the focused node; otherwise choose the least-developed useful branch. Leave other possible branches for later turns.
- Prefer concrete graph operations over long explanations. If the user asks to change the graph, return a patch that actually changes it.
- If the current graph already satisfies the request, still make a useful small improvement when possible: clearer labels, better grouping, missing edges, better layout, or shorter node bodies.
- Avoid empty reassurance like "already done" unless the patch contains real operations.
- Do not create duplicate nodes that restate existing titles. Update/merge existing nodes when appropriate.
- Preserve user work. Only delete placeholder/demo nodes or clearly redundant nodes.
- In an existing non-empty graph, default to additive continuation: add the next useful nodes/edges and re-layout. Do not rewrite, rename, or replace existing middle nodes unless the user explicitly asks to edit or simplify them.
- Use focused nodes marked with ▶ as the editing target. If there is no focus, operate on the whole graph.
- Keep replies concise, in the user's language, and say what changed in one or two sentences.

Graph design judgment:
- **flow**: workflows, procedures, user journeys, pipelines. Use left-to-right progression.
- **mindmap**: categories, strategy, concepts, brainstorming. Use exactly one central topic node. Every top-level branch must connect from that center; never create multiple independent centers.
- **architecture**: systems, services, components, dependencies. Use layered groups.
- Node kinds you may generate: concept = category/idea, system = component/tool, note = clarification.
- Do NOT create or update nodes with kind process or decision. In NeMind, action/process and decision nodes are human manual labels only. If you see useful action candidates or decision candidates, describe them as ordinary concept/note nodes or mention them in the reply, but do not mark them as process/decision.
- Node titles should be short and scannable. Bodies should add useful detail, not repeat the title.
- Edges should encode real relationships. Label only when the relation is not obvious.
- Keep patches small: usually 1-4 addNode operations per reply. Exceed this only when the user explicitly asks for a complete exhaustive map.
- After adding a line, stop and invite the user to continue with the next line instead of filling every branch.

Patch rules:
- For creation from an empty/placeholder graph, delete placeholder nodes and build a coherent graph.
- For creation from an empty/placeholder graph, build the first useful line only; do not complete every branch.
- For a traditional mindmap, create one and only one central root concept, then attach one main branch at a time.
- For modification of an existing graph, prefer updateNode/addNode/addEdge/deleteEdge/layoutGraph over rebuilding everything.
- For "整理/布局/排版", use layoutGraph and only update/delete/add nodes if it improves clarity.
- Always end operations with a layoutGraph using the best mode.

Reply format — MUST end with exactly one JSON code block:
\`\`\`json
{
  "reply": "your natural language reply",
  "patch": {
    "summary": "one-line summary of changes",
    "operations": [...]
  }
}
\`\`\`

Operation types: addNode, updateNode, deleteNode, addEdge, updateEdge, deleteEdge, layoutGraph.
For addNode: { "type": "addNode", "node": { "id": "n1", "data": { "title": "...", "kind": "concept", "body": "optional detail" } } }
For addEdge: { "type": "addEdge", "edge": { "source": "n1", "target": "n2", "label": "optional label" } }
For deleteNode: { "type": "deleteNode", "id": "node-id" }
Always end operations with a layoutGraph: { "type": "layoutGraph", "mode": "flow" } (or mindmap/architecture).`;

const chatOnlySystemPrompt = `You are NeMind's thinking partner. The user is in CHAT-ONLY mode, so do not create or modify graphs.

Be direct, context-aware, and concise. If the user asks for "grill me", challenge their thinking with sharp, specific questions. Focus on weak assumptions, unclear decisions, missing evidence, risky actions, and the next concrete commitment. Do NOT output JSON code blocks or graph patches.`;
