import type { GraphDocument, GraphEdge, GraphNode } from "@/lib/types";
import { createSeedDocument } from "@/lib/graph";
import { makeId } from "@/lib/ids";
import { layoutNodes } from "@/lib/layout";

type ImportResult =
  | { ok: true; document: GraphDocument }
  | { ok: false; error: string; source: string };

export function importTextAsGraph(source: string): ImportResult {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, error: "No import text was provided.", source };
  }

  if (/^(flowchart|graph)\s+/i.test(trimmed)) {
    return importMermaidFlowchart(trimmed);
  }

  return importMarkdownList(trimmed);
}

function importMarkdownList(source: string): ImportResult {
  const lines = source
    .split(/\r?\n/)
    .map((line) => ({
      raw: line,
      match: line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/),
    }))
    .filter((line) => line.match);

  if (!lines.length) {
    return { ok: false, error: "Markdown list items were not found.", source };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const stack: { level: number; id: string }[] = [];

  for (const line of lines) {
    const match = line.match!;
    const level = Math.floor(match[1].replace(/\t/g, "  ").length / 2);
    const id = makeId("node");
    nodes.push({
      id,
      type: "graphNode",
      position: { x: 0, y: 0 },
      data: { title: match[3].trim(), kind: level === 0 ? "concept" : "note" },
    });

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      edges.push({
        id: `edge-${parent.id}-${id}`,
        source: parent.id,
        target: id,
      });
    }
    stack.push({ level, id });
  }

  return finishImport(
    nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        color: node.data.kind === "concept" ? "#d8f3dc" : "#f1f5f9",
      },
    })),
    edges,
    "Imported outline",
    "mindmap",
  );
}

function importMermaidFlowchart(source: string): ImportResult {
  const nodeLabels = new Map<string, string>();
  const edges: GraphEdge[] = [];
  const edgeRegex =
    /([A-Za-z0-9_]+)(?:\[(.*?)\]|\((.*?)\)|\{(.*?)\})?\s*[-=.]+(?:>|-)\s*([A-Za-z0-9_]+)(?:\[(.*?)\]|\((.*?)\)|\{(.*?)\})?/g;

  for (const line of source.split(/\r?\n/)) {
    let match: RegExpExecArray | null;
    while ((match = edgeRegex.exec(line))) {
      const sourceId = normalizeMermaidId(match[1]);
      const targetId = normalizeMermaidId(match[5]);
      nodeLabels.set(sourceId, match[2] || match[3] || match[4] || match[1]);
      nodeLabels.set(targetId, match[6] || match[7] || match[8] || match[5]);
      edges.push({
        id: `edge-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
      });
    }
  }

  if (!nodeLabels.size) {
    return {
      ok: false,
      error: "Only simple Mermaid flowchart edges are supported in v1.",
      source,
    };
  }

  const nodes = [...nodeLabels.entries()].map<GraphNode>(([id, title]) => ({
    id,
    type: "graphNode",
    position: { x: 0, y: 0 },
    data: { title, kind: "process", color: "#dbeafe" },
  }));

  return finishImport(nodes, edges, "Imported flowchart", "flow");
}

function finishImport(
  nodes: GraphNode[],
  edges: GraphEdge[],
  title: string,
  mode: "mindmap" | "flow",
): ImportResult {
  const seed = createSeedDocument();
  return {
    ok: true,
    document: {
      ...seed,
      title,
      nodes: layoutNodes(nodes, edges, mode),
      edges,
      messages: [],
    },
  };
}

function normalizeMermaidId(id: string) {
  return `m-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
