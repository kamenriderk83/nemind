import type { AiChatRequest, AiChatResponse } from "@/lib/types";
import { graphPatchSchema } from "@/lib/schema";

export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export function normalizeOpenAiBaseUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  const withoutChatEndpoint = trimmed.endsWith("/chat/completions")
    ? trimmed.slice(0, -"/chat/completions".length)
    : trimmed;
  const withoutModelsEndpoint = withoutChatEndpoint.endsWith("/models")
    ? withoutChatEndpoint.slice(0, -"/models".length)
    : withoutChatEndpoint;

  try {
    const url = new URL(withoutModelsEndpoint);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    return withoutModelsEndpoint;
  }

  return withoutModelsEndpoint;
}

export async function listOpenAiCompatibleModels({
  apiKey,
  baseUrl,
}: {
  apiKey?: string;
  baseUrl: string;
}) {
  const normalizedBaseUrl = normalizeOpenAiBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return [];

  const response = await fetch(`${normalizedBaseUrl}/models`, {
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
        }
      : undefined,
  });

  if (!response.ok) {
    throw new Error(`Model list error ${response.status}`);
  }

  const data = await response.json();
  const rawModels = Array.isArray(data?.data) ? data.data : [];
  return rawModels
    .map((item: unknown) =>
      item && typeof item === "object" && "id" in item
        ? String((item as { id: unknown }).id)
        : "",
    )
    .filter(Boolean);
}

export async function chatWithOpenAiCompatibleEndpoint({
  apiKey,
  url,
  model,
  request,
  providerName,
  systemPrompt,
}: {
  apiKey: string;
  url: string;
  model: string;
  request: AiChatRequest;
  providerName: string;
  systemPrompt: string;
}): Promise<AiChatResponse> {
  const requestBody = createChatRequestBody({ model, request, systemPrompt });
  let response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const fallbackBody = { ...requestBody };
    const hadReasoning = "reasoning_effort" in fallbackBody;
    const hadResponseFormat = "response_format" in fallbackBody;
    if (hadReasoning) delete fallbackBody.reasoning_effort;
    if (hadResponseFormat) delete fallbackBody.response_format;
    if (hadReasoning || hadResponseFormat) {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fallbackBody),
      });
    }
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return {
      reply: `${providerName} returned an error before a graph patch could be created.`,
      error: `${providerName} error ${response.status}: ${errText.slice(0, 200)}`,
    };
  }

  const data = await response.json();
  const rawContent: string = data?.choices?.[0]?.message?.content ?? "";
  if (!rawContent) {
    return {
      reply: `${providerName} did not return usable content.`,
      error: "Empty model response",
    };
  }

  if (request.chatOnly) {
    return { reply: rawContent };
  }

  return parseModelContent(rawContent);
}

function buildGraphContext(request: AiChatRequest): string {
  const focusedSet = new Set(request.focusedNodeIds ?? []);
  const hasFocus = focusedSet.size > 0 && focusedSet.size < request.document.nodes.length;
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const node of request.document.nodes) {
    outgoing.set(node.id, 0);
    incoming.set(node.id, 0);
  }
  for (const edge of request.document.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const nodeList = request.document.nodes
    .map((n) => {
      const marker = hasFocus && focusedSet.has(n.id) ? " ▶" : "";
      const degree = `in:${incoming.get(n.id) ?? 0}, out:${outgoing.get(n.id) ?? 0}`;
      const position = `x:${Math.round(n.position.x)}, y:${Math.round(n.position.y)}`;
      return `  - [${n.id}]${marker} ${n.data.title}${n.data.body ? ` — ${n.data.body}` : ""} (${n.data.kind ?? "concept"}; ${degree}; ${position})`;
    })
    .join("\n");
  const edgeList = request.document.edges
    .map((e) => `  - ${e.source} → ${e.target}${e.label ? ` (${e.label})` : ""}`)
    .join("\n");

  const focusNote = hasFocus
    ? `\nThe user is focused on nodes marked with ▶. Prioritize these in your changes.`
    : "";
  const graphShape = inferGraphShape(request);
  const userIntent = inferUserIntent(request.message);

  return `Current graph state:
Document title: ${request.document.title}
Likely current graph shape: ${graphShape}
Interpreted user intent: ${userIntent}
Nodes (${request.document.nodes.length}):
${nodeList || "  (empty)"}

Edges (${request.document.edges.length}):
${edgeList || "  (empty)"}${focusNote}`;
}

function inferGraphShape(request: AiChatRequest) {
  const title = request.document.title.toLowerCase();
  const kinds = new Map<string, number>();
  for (const node of request.document.nodes) {
    const kind = node.data.kind ?? "concept";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  if (title.includes("流程") || (kinds.get("process") ?? 0) >= (kinds.get("concept") ?? 0)) {
    return "probably a flow/process map";
  }
  if ((kinds.get("system") ?? 0) >= 2) return "probably an architecture/system map";
  return "probably a mindmap/knowledge map";
}

function inferUserIntent(message: string) {
  const text = message.trim().toLowerCase();
  if (
    /整理|重新整理|重整|排版|布局|优化布局|梳理|收拾|归整/.test(text) ||
    /\b(layout|arrange|clean up|organize|reorganize|re-layout)\b/.test(text)
  ) {
    return "re-layout and tidy the existing graph; avoid adding unrelated content";
  }
  if (/继续|补充|细一点|展开|下一条线|下一个分支|more|continue|expand/.test(text)) {
    return "extend the current graph with the next single useful line or branch only";
  }
  if (/太乱|简化|精简|少一点|simplify|reduce/.test(text)) {
    return "simplify the graph by merging/removing weak or redundant structure";
  }
  if (/改成|变成|转换|convert|change/.test(text)) {
    return "transform existing graph structure while preserving useful content";
  }
  if (/解释|说明|怎么看|分析|why|explain/.test(text)) {
    return "answer and optionally add explanatory notes only if useful";
  }
  return "infer from the message and current graph; make one concrete line-by-line graph change when appropriate";
}

function createChatRequestBody({
  model,
  request,
  systemPrompt,
}: {
  model: string;
  request: AiChatRequest;
  systemPrompt: string;
}) {
  const reasoningEffort = normalizeReasoningEffort(request.reasoningEffort);
  const graphContext = request.chatOnly ? "" : `\n\n${buildGraphContext(request)}`;

  const conversationMessages = request.recentMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: `${systemPrompt}${graphContext}`,
      },
      ...conversationMessages,
      {
        role: "user",
        content: request.message,
      },
    ],
  };

  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  return body;
}

function normalizeReasoningEffort(value: AiChatRequest["reasoningEffort"]) {
  if (!value || value === "auto") return undefined;
  if (value === "max") return "high";
  return value;
}

function normalizeModelPatch(input: unknown) {
  if (!input || typeof input !== "object") return input;

  const patch = input as {
    summary?: unknown;
    operations?: unknown;
  };

  if (!Array.isArray(patch.operations)) return input;

  return {
    ...patch,
    summary:
      typeof patch.summary === "string" && patch.summary.trim()
        ? patch.summary
        : "Updated the graph.",
    operations: patch.operations.map((operation) => {
      if (!operation || typeof operation !== "object") return operation;
      const op = operation as Record<string, unknown>;

      if (op.type === "addNode" && !op.node) {
        const nestedData =
          op.data && typeof op.data === "object"
            ? (op.data as Record<string, unknown>)
            : null;
        const payload =
          nestedData &&
          ("data" in nestedData || "position" in nestedData || "id" in nestedData) &&
          !("title" in nestedData)
            ? nestedData
            : op;
        const nodeData =
          payload.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : payload;
        return {
          type: "addNode",
          node: {
            id: typeof payload.id === "string" ? payload.id : undefined,
            position:
              payload.position &&
              typeof payload.position === "object" &&
              "x" in payload.position &&
              "y" in payload.position
                ? payload.position
                : undefined,
            data: {
              title:
                typeof nodeData.title === "string"
                  ? nodeData.title
                  : typeof payload.title === "string"
                    ? payload.title
                    : "New node",
              body:
                typeof nodeData.body === "string"
                  ? nodeData.body
                  : typeof payload.body === "string"
                    ? payload.body
                    : undefined,
              kind:
                typeof nodeData.kind === "string"
                  ? nodeData.kind
                  : typeof payload.kind === "string"
                    ? payload.kind
                    : undefined,
              color:
                typeof nodeData.color === "string"
                  ? nodeData.color
                  : typeof payload.color === "string"
                    ? payload.color
                    : undefined,
            },
          },
        };
      }

      if (op.type === "addEdge" && !op.edge) {
        const nestedData =
          op.data && typeof op.data === "object"
            ? (op.data as Record<string, unknown>)
            : null;
        const payload =
          nestedData &&
          ("source" in nestedData ||
            "target" in nestedData ||
            "from" in nestedData ||
            "to" in nestedData)
            ? nestedData
            : op;
        const edgeData =
          payload.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : nestedData ?? payload;
        return {
          type: "addEdge",
          edge: {
            id: typeof payload.id === "string" ? payload.id : undefined,
            source: payload.source ?? payload.from,
            target: payload.target ?? payload.to,
            label:
              typeof payload.label === "string"
                ? payload.label
                : typeof edgeData.label === "string"
                  ? edgeData.label
                  : undefined,
          },
        };
      }

      if (op.type === "layoutGraph" && !op.mode) {
        const payload =
          op.data && typeof op.data === "object"
            ? (op.data as Record<string, unknown>)
            : op;
        return {
          type: "layoutGraph",
          mode: typeof payload.mode === "string" ? payload.mode : "flow",
        };
      }

      if (op.type === "deleteNode") {
        return {
          type: "deleteNode",
          id: typeof op.id === "string" ? op.id : typeof op.nodeId === "string" ? op.nodeId : "",
        };
      }

      if (op.type === "updateNode") {
        return {
          type: "updateNode",
          id: typeof op.id === "string" ? op.id : typeof op.nodeId === "string" ? op.nodeId : "",
          ...(op.data ? { data: op.data } : {}),
          ...(op.position ? { position: op.position } : {}),
        };
      }

      if (op.type === "deleteEdge") {
        return {
          type: "deleteEdge",
          id: typeof op.id === "string" ? op.id : typeof op.edgeId === "string" ? op.edgeId : "",
        };
      }

      if (op.type === "updateEdge") {
        return {
          type: "updateEdge",
          id: typeof op.id === "string" ? op.id : typeof op.edgeId === "string" ? op.edgeId : "",
          ...(op.label !== undefined ? { label: op.label } : {}),
          ...(op.data ? { data: op.data } : {}),
        };
      }

      return operation;
    }),
  };
}

function parseModelContent(content: string): AiChatResponse {
  // 1. Try direct JSON parse
  try {
    const parsed = JSON.parse(content);
    const patchInput = normalizeModelPatch(parsed.patch ?? parsed);
    const patch = graphPatchSchema.parse(patchInput);
    return {
      reply: String(parsed.reply ?? patch.summary),
      patch,
    };
  } catch {
    // continue to fallbacks
  }

  // 2. Try extracting JSON from ```json ... ``` code block
  const jsonBlock = extractCodeBlock(content, "json");
  if (jsonBlock) {
    const result = tryParseJsonBlock(jsonBlock);
    if (result) return result;
  }

  // 3. Try extracting JSON from any ``` ... ``` code block
  const anyBlock = extractCodeBlock(content);
  if (anyBlock) {
    const result = tryParseJsonBlock(anyBlock);
    if (result) return result;
  }

  // 4. Try finding a JSON object anywhere in the text
  const jsonMatch = content.match(/\{[\s\S]*"reply"[\s\S]*"patch"[\s\S]*\}/);
  if (jsonMatch) {
    const result = tryParseJsonBlock(jsonMatch[0]);
    if (result) return result;
  }

  // 5. Return raw content - no structured patch
  return {
    reply: content,
  };
}

function extractCodeBlock(text: string, language?: string): string | null {
  const lang = language ? language + "\\s*" : "";
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "i");
  const match = text.match(re);
  return match ? match[1].trim() : null;
}

function tryParseJsonBlock(jsonText: string): AiChatResponse | null {
  try {
    const parsed = JSON.parse(jsonText);
    const patchInput = normalizeModelPatch(parsed.patch ?? parsed);
    const patch = graphPatchSchema.parse(patchInput);
    return {
      reply: String(parsed.reply ?? patch.summary),
      patch,
    };
  } catch {
    return null;
  }
}
