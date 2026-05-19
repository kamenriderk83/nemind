import { NextResponse } from "next/server";
import { createProvider } from "@/lib/ai/providers";
import { aiChatRequestSchema } from "@/lib/schema";
import type {
  AiChatRequest,
  AiChatResponse,
  GraphEdge,
  GraphNode,
  GraphPatchOperation,
  LayoutMode,
} from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = aiChatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        reply: "The request shape was invalid.",
        error: parsed.error.message,
      },
      { status: 400 },
    );
  }

  const provider = createProvider(parsed.data.provider);
  const chatRequest = parsed.data as AiChatRequest;
  const response = enforceMindmapRoot(
    enforceLineByLineGeneration(
      enforceManualOnlyActionDecisionKinds(
        withDeterministicFallback(
          await provider.chat(chatRequest),
          chatRequest,
        ),
        chatRequest,
      ),
      chatRequest,
    ),
    chatRequest,
  );
  return NextResponse.json(response);
}

function enforceLineByLineGeneration(
  response: AiChatResponse,
  request: AiChatRequest,
): AiChatResponse {
  if (request.chatOnly || !response.patch) return response;
  if (isOrganizeIntent(request.message)) return response;

  const maxAddedNodes = isCompleteMapRequest(request.message) ? 8 : 4;
  const addNodeOps = response.patch.operations.filter((op) => op.type === "addNode");
  if (addNodeOps.length <= maxAddedNodes) return response;

  const keptNodeIds = new Set(
    addNodeOps
      .slice(0, maxAddedNodes)
      .map((op) => op.node.id)
      .filter((id): id is string => Boolean(id)),
  );
  const existingNodeIds = new Set(request.document.nodes.map((node) => node.id));

  const operations = response.patch.operations.filter((op) => {
    if (op.type === "addNode") return !op.node.id || keptNodeIds.has(op.node.id);
    if (op.type !== "addEdge") return true;
    const sourceIsNew = !existingNodeIds.has(op.edge.source);
    const targetIsNew = !existingNodeIds.has(op.edge.target);
    if (sourceIsNew && !keptNodeIds.has(op.edge.source)) return false;
    if (targetIsNew && !keptNodeIds.has(op.edge.target)) return false;
    return true;
  });

  return {
    ...response,
    reply: `${response.reply}\n\n我先保留这一条主线，其他分支可以继续逐条展开。`,
    patch: {
      ...response.patch,
      summary: `${response.patch.summary} Kept one line for step-by-step expansion.`,
      operations,
    },
  };
}

function enforceMindmapRoot(
  response: AiChatResponse,
  request: AiChatRequest,
): AiChatResponse {
  if (request.chatOnly || !response.patch) return response;
  if (!response.patch.operations.some((op) => op.type === "layoutGraph" && op.mode === "mindmap")) {
    return response;
  }

  const nodes = new Map(request.document.nodes.map((node) => [node.id, node]));
  const edges = new Set(request.document.edges.map((edge) => edgeKey(edge.source, edge.target)));

  for (const operation of response.patch.operations) {
    if (operation.type === "addNode" && operation.node.id) {
      nodes.set(operation.node.id, {
        id: operation.node.id,
        type: "graphNode",
        position: operation.node.position ?? { x: 0, y: 0 },
        data: operation.node.data,
      });
    }
    if (operation.type === "deleteNode") nodes.delete(operation.id);
    if (operation.type === "addEdge") edges.add(edgeKey(operation.edge.source, operation.edge.target));
    if (operation.type === "deleteEdge") {
      const edge = request.document.edges.find((item) => item.id === operation.id);
      if (edge) edges.delete(edgeKey(edge.source, edge.target));
    }
  }

  const root = findSingleMindmapRoot([...nodes.values()], edges);
  if (!root) return response;

  const incoming = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (const key of edges) {
    const [, target] = key.split("->");
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  const missingRootEdges: GraphPatchOperation[] = [];
  for (const node of nodes.values()) {
    if (node.id === root.id || (incoming.get(node.id) ?? 0) > 0) continue;
    const key = edgeKey(root.id, node.id);
    if (edges.has(key)) continue;
    edges.add(key);
    missingRootEdges.push({
      type: "addEdge",
      edge: {
        id: `edge-${root.id}-${node.id}`,
        source: root.id,
        target: node.id,
      },
    });
  }

  if (!missingRootEdges.length) return response;
  return {
    ...response,
    patch: {
      ...response.patch,
      operations: [
        ...response.patch.operations.filter((op) => op.type !== "layoutGraph"),
        ...missingRootEdges,
        ...response.patch.operations.filter((op) => op.type === "layoutGraph"),
      ],
    },
  };
}

function enforceManualOnlyActionDecisionKinds(
  response: AiChatResponse,
  request: AiChatRequest,
): AiChatResponse {
  if (request.chatOnly || !response.patch) return response;

  const operations = response.patch.operations
    .map((operation): GraphPatchOperation | null => {
      if (operation.type === "addNode") {
        const kind = operation.node.data.kind;
        if (kind !== "process" && kind !== "decision") return operation;
        return {
          ...operation,
          node: {
            ...operation.node,
            data: {
              ...operation.node.data,
              kind: "concept",
              color: "#f8fafc",
            },
          },
        };
      }

      if (operation.type === "updateNode" && operation.data) {
        const kind = operation.data.kind;
        if (kind !== "process" && kind !== "decision") return operation;
        const data = { ...operation.data };
        delete data.kind;
        delete data.color;
        if (!Object.keys(data).length && !operation.position) return null;
        return {
          ...operation,
          data: Object.keys(data).length ? data : undefined,
        };
      }

      return operation;
    })
    .filter((operation): operation is GraphPatchOperation => Boolean(operation));

  return {
    ...response,
    patch: {
      ...response.patch,
      operations,
    },
  };
}

function withDeterministicFallback(
  response: AiChatResponse,
  request: AiChatRequest,
): AiChatResponse {
  if (request.chatOnly) return response;

  if (isOrganizeIntent(request.message)) {
    const fallback = buildFallbackPatch(request);
    if (
      fallback?.patch &&
      (!response.patch || isNonStructuralOrganizePatch(response.patch.operations))
    ) {
      return {
        reply: fallback.reply,
        patch: fallback.patch,
      };
    }
  }

  if (response.patch) return response;

  const fallback = buildFallbackPatch(request);
  if (!fallback) return response;

  return {
    reply: fallback.reply,
    patch: fallback.patch,
  };
}

function buildFallbackPatch(request: AiChatRequest): AiChatResponse | null {
  const text = request.message.trim().toLowerCase();
  if (!text) return null;

  if (isOrganizeIntent(text)) {
    const { operations, changed, notes } = buildOrganizeOperations(request);
    return {
      reply: changed
        ? `已做结构整理：${notes.join("、")}。`
        : "已按当前节点关系重新整理布局。",
      patch: {
        summary: changed
          ? "Organize graph structure and layout."
          : "Re-layout current graph.",
        operations,
      },
    };
  }

  return null;
}

function isOrganizeIntent(message: string) {
  const text = message.trim().toLowerCase();
  return (
    /整理|重新整理|重整|排版|布局|优化布局|梳理|收拾|归整/.test(text) ||
    /\b(layout|arrange|organize|clean up|reorganize|re-layout)\b/.test(text)
  );
}

function isCompleteMapRequest(message: string) {
  const text = message.trim().toLowerCase();
  return /完整|全面|全部|所有|完整导图|完整流程|complete|full|whole|entire|exhaustive/.test(text);
}

function isNonStructuralOrganizePatch(operations: GraphPatchOperation[]) {
  return (
    operations.length === 0 ||
    operations.every((op) =>
      op.type === "layoutGraph" ||
      op.type === "explain" ||
      op.type === "setSelection"
    )
  );
}

function findSingleMindmapRoot(nodes: GraphNode[], edges: Set<string>) {
  if (!nodes.length) return null;
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  for (const key of edges) {
    const [source, target] = key.split("->");
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
    outgoing.set(source, (outgoing.get(source) ?? 0) + 1);
  }

  return [...nodes].sort((a, b) => {
    const aRoot = incoming.get(a.id) === 0 ? 1 : 0;
    const bRoot = incoming.get(b.id) === 0 ? 1 : 0;
    if (aRoot !== bRoot) return bRoot - aRoot;
    if (aRoot === 1) return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    return (outgoing.get(b.id) ?? 0) - (outgoing.get(a.id) ?? 0);
  })[0];
}

function buildOrganizeOperations(request: AiChatRequest): {
  mode: LayoutMode;
  operations: GraphPatchOperation[];
  changed: boolean;
  notes: string[];
} {
  const mode = inferLayoutMode(request);
  const nodes = request.document.nodes;
  if (nodes.length < 2) {
    return {
      mode,
      operations: [{ type: "layoutGraph", mode }],
      changed: false,
      notes: ["节点较少，仅调整布局"],
    };
  }

  const currentKeys = new Set(
    request.document.edges.map((edge) => edgeKey(edge.source, edge.target)),
  );
  const duplicateGroups = findDuplicateNodeGroups(nodes);
  const duplicateIds = new Set(duplicateGroups.flatMap((group) => group.slice(1).map((node) => node.id)));
  const activeNodes = nodes.filter((node) => !duplicateIds.has(node.id));
  const activeEdges = request.document.edges.filter(
    (edge) => !duplicateIds.has(edge.source) && !duplicateIds.has(edge.target),
  );
  const desiredEdges = inferLogicalEdges(activeNodes, activeEdges, mode);
  const operations: GraphPatchOperation[] = [];
  const notes: string[] = [];

  for (const group of duplicateGroups) {
    const primary = group[0];
    const duplicates = group.slice(1);
    const mergedBody = mergeBodies(group);
    if (mergedBody && mergedBody !== primary.data.body) {
      operations.push({
        type: "updateNode",
        id: primary.id,
        data: { body: mergedBody },
      });
    }
    for (const duplicate of duplicates) {
      for (const edge of request.document.edges) {
        if (edge.source === duplicate.id && edge.target !== primary.id && !duplicateIds.has(edge.target)) {
          desiredEdges.push({ source: primary.id, target: edge.target, label: stringLabel(edge.label) });
        }
        if (edge.target === duplicate.id && edge.source !== primary.id && !duplicateIds.has(edge.source)) {
          desiredEdges.push({ source: edge.source, target: primary.id, label: stringLabel(edge.label) });
        }
      }
      operations.push({ type: "deleteNode", id: duplicate.id });
    }
  }

  if (duplicateGroups.length) {
    notes.push(`合并 ${duplicateGroups.length} 组重复节点`);
  }

  const finalDesiredEdges = dedupeInferredEdges(desiredEdges);
  const desiredKeys = new Set(finalDesiredEdges.map((edge) => edgeKey(edge.source, edge.target)));
  let retiredEdgeCount = 0;

  for (const edge of request.document.edges) {
    const shouldRetireWeakEdge =
      !desiredKeys.has(edgeKey(edge.source, edge.target)) &&
      (mode === "mindmap" ||
        (activeNodes.length > 4 && isWeakInferredEdge(edge, activeNodes, activeEdges, mode)));
    if (
      edge.source === edge.target ||
      duplicateIds.has(edge.source) ||
      duplicateIds.has(edge.target) ||
      !nodes.some((n) => n.id === edge.source) ||
      !nodes.some((n) => n.id === edge.target) ||
      shouldRetireWeakEdge
    ) {
      operations.push({ type: "deleteEdge", id: edge.id });
      retiredEdgeCount += 1;
    }
  }

  if (retiredEdgeCount > 0) {
    notes.push(`清理 ${retiredEdgeCount} 条无效或低可信连接`);
  }

  let addedEdgeCount = 0;
  for (const edge of finalDesiredEdges) {
    if (!currentKeys.has(edgeKey(edge.source, edge.target))) {
      operations.push({
        type: "addEdge",
        edge: {
          source: edge.source,
          target: edge.target,
          label: edge.label,
          data: edge.label ? { kind: "association" } : undefined,
        },
      });
      addedEdgeCount += 1;
    }
  }

  if (addedEdgeCount > 0) {
    notes.push(`补齐 ${addedEdgeCount} 条逻辑连接`);
  }

  operations.push({ type: "layoutGraph", mode });
  return {
    mode,
    operations,
    changed: operations.length > 1,
    notes: notes.length ? notes : ["按现有关系重新布局"],
  };
}

function inferLogicalEdges(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: LayoutMode,
) {
  if (mode === "mindmap") return inferMindmapEdges(nodes, edges);
  return inferLayeredEdges(nodes);
}

function inferLayeredEdges(nodes: GraphNode[]) {
  const columns = groupNodesByColumns(nodes);
  const edges: Array<{ source: string; target: string; label?: string }> = [];
  if (columns.length <= 1) return inferSingleColumnEdges(nodes);

  for (let i = 0; i < columns.length - 1; i += 1) {
    const left = columns.slice(0, i + 1).flat();
    const right = columns[i + 1];
    for (const target of right) {
      const source = findBestSource(left, target);
      if (source && edgeConfidence(source, target) >= 0.25) {
        edges.push({ source: source.id, target: target.id });
      }
    }
  }

  attachOrphans(nodes, edges);

  return dedupeInferredEdges(edges);
}

function inferSingleColumnEdges(nodes: GraphNode[]) {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  return sorted.slice(1).map((node, index) => ({
    source: sorted[index].id,
    target: node.id,
    label: undefined,
  }));
}

function inferMindmapEdges(nodes: GraphNode[], edges: GraphEdge[]) {
  const existingRoot = nodes.find(
    (node) => !edges.some((edge) => edge.target === node.id) && edges.some((edge) => edge.source === node.id),
  );
  const root = existingRoot ?? nodes.reduce((best, node) => {
    const score = titleTokens(node).size + (node.data.body?.length ?? 0) / 80;
    const bestScore = titleTokens(best).size + (best.data.body?.length ?? 0) / 80;
    return score > bestScore ? node : best;
  }, nodes[0]);

  return nodes
    .filter((node) => node.id !== root.id)
    .map((node) => ({ source: root.id, target: node.id, label: undefined }));
}

function groupNodesByColumns(nodes: GraphNode[]) {
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const columns: GraphNode[][] = [];
  for (const node of sorted) {
    const centerX = node.position.x + (node.measured?.width ?? 220) / 2;
    const column = columns.find((items) => {
      const sample = items[0];
      const sampleX = sample.position.x + (sample.measured?.width ?? 220) / 2;
      return Math.abs(sampleX - centerX) < 170;
    });
    if (column) column.push(node);
    else columns.push([node]);
  }

  return columns
    .map((items) => items.sort((a, b) => a.position.y - b.position.y))
    .sort((a, b) => a[0].position.x - b[0].position.x);
}

function findBestSource(candidates: GraphNode[], target: GraphNode) {
  let best: GraphNode | null = null;
  let bestScore = -Infinity;
  for (const source of candidates) {
    const score =
      edgeConfidence(source, target) * 10 -
      Math.abs(source.position.y - target.position.y) / 240;
    if (score > bestScore) {
      best = source;
      bestScore = score;
    }
  }
  return best;
}

function attachOrphans(
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string; label?: string }>,
) {
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const ordered = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  for (const node of ordered) {
    if (connected.has(node.id) || ordered[0].id === node.id) continue;
    const candidates = ordered.filter((candidate) => candidate.position.x < node.position.x - 80);
    const source = findBestSource(candidates.length ? candidates : ordered.filter((candidate) => candidate.id !== node.id), node);
    if (source && edgeConfidence(source, node) >= 0.15) {
      edges.push({ source: source.id, target: node.id, label: "归类" });
      connected.add(source.id);
      connected.add(node.id);
    }
  }
}

function edgeConfidence(source: GraphNode, target: GraphNode) {
  const overlap = tokenOverlapScore(source, target);
  const verticalCloseness = 1 / (1 + Math.abs(source.position.y - target.position.y) / 260);
  const horizontalForward = target.position.x >= source.position.x ? 0.6 : -0.4;
  const kindBoost = source.data.kind === "concept" && target.data.kind !== "concept" ? 0.4 : 0;
  return overlap * 0.75 + verticalCloseness + horizontalForward + kindBoost;
}

function isWeakInferredEdge(
  edge: GraphEdge,
  nodes: GraphNode[],
  existingEdges: GraphEdge[],
  mode: LayoutMode,
) {
  if (mode === "mindmap") return false;
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return true;
  if (target.position.x < source.position.x - 120) return true;
  const targetIncoming = existingEdges.filter((item) => item.target === edge.target);
  return targetIncoming.length > 1 && edgeConfidence(source, target) < 0.8;
}

function tokenOverlapScore(a: GraphNode, b: GraphNode) {
  const aTokens = titleTokens(a);
  const bTokens = titleTokens(b);
  let score = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) score += token.length > 1 ? 2 : 1;
  }
  return score;
}

function findDuplicateNodeGroups(nodes: GraphNode[]) {
  const groups: GraphNode[][] = [];
  const used = new Set<string>();
  for (const node of nodes) {
    if (used.has(node.id)) continue;
    const group = nodes.filter(
      (candidate) =>
        candidate.id !== node.id &&
        !used.has(candidate.id) &&
        isDuplicateNode(node, candidate),
    );
    if (group.length) {
      const fullGroup = [node, ...group].sort((a, b) => {
        const aScore = (a.data.body?.length ?? 0) + titleTokens(a).size * 10;
        const bScore = (b.data.body?.length ?? 0) + titleTokens(b).size * 10;
        return bScore - aScore;
      });
      fullGroup.forEach((item) => used.add(item.id));
      groups.push(fullGroup);
    }
  }
  return groups;
}

function isDuplicateNode(a: GraphNode, b: GraphNode) {
  const aTitle = normalizeTitle(a.data.title);
  const bTitle = normalizeTitle(b.data.title);
  if (!aTitle || !bTitle) return false;
  if (aTitle === bTitle) return true;

  const overlap = tokenOverlapScore(a, b);
  const minTokens = Math.min(titleTokens(a).size, titleTokens(b).size);
  return minTokens > 0 && overlap >= Math.max(2, minTokens * 1.5);
}

function mergeBodies(nodes: GraphNode[]) {
  const parts = nodes
    .map((node) => node.data.body?.trim())
    .filter((body): body is string => Boolean(body));
  return Array.from(new Set(parts)).join("\n");
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]/gu, "")
    .trim();
}

function stringLabel(value: GraphEdge["label"]) {
  return typeof value === "string" ? value : undefined;
}

function titleTokens(node: GraphNode) {
  const text = `${node.data.title} ${node.data.body ?? ""}`.toLowerCase();
  const tokens = text.match(/[\p{Script=Han}]{1,4}|[a-z0-9]+/gu) ?? [];
  return new Set(tokens.filter((token) => token.trim().length > 0));
}

function dedupeInferredEdges(edges: Array<{ source: string; target: string; label?: string }>) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = edgeKey(edge.source, edge.target);
    if (seen.has(key)) return false;
    seen.add(key);
    return edge.source !== edge.target;
  });
}

function edgeKey(source: string, target: string) {
  return `${source}->${target}`;
}

function inferLayoutMode(request: AiChatRequest): LayoutMode {
  const title = request.document.title.toLowerCase();
  if (title.includes("流程")) return "flow";

  const kindCounts = new Map<string, number>();
  for (const node of request.document.nodes) {
    const kind = node.data.kind ?? "concept";
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }

  if ((kindCounts.get("system") ?? 0) >= 2) return "architecture";
  if ((kindCounts.get("process") ?? 0) >= (kindCounts.get("concept") ?? 0)) return "flow";
  return "mindmap";
}
