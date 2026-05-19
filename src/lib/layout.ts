import type { GraphEdge, GraphNode, LayoutMode } from "@/lib/types";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 110;

export function layoutNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: LayoutMode,
): GraphNode[] {
  if (nodes.length === 0) return nodes;

  if (mode === "architecture") {
    return layeredLayout(nodes, edges, 260, 170);
  }

  if (mode === "mindmap") {
    return mindmapLayout(nodes, edges);
  }

  return layeredLayout(nodes, edges, 280, 140);
}

function layeredLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  columnGap: number,
  rowGap: number,
) {
  const incoming = new Map<string, number>();
  const bySource = new Map<string, string[]>();

  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge.target]);
  }

  const roots = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const queue = roots.length ? roots.map((node) => node.id) : [nodes[0].id];
  const depth = new Map<string, number>(queue.map((id) => [id, 0]));

  while (queue.length) {
    const id = queue.shift()!;
    const nextDepth = (depth.get(id) ?? 0) + 1;
    for (const target of bySource.get(id) ?? []) {
      if (!depth.has(target) || nextDepth < (depth.get(target) ?? 0)) {
        depth.set(target, nextDepth);
        queue.push(target);
      }
    }
  }

  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node]);
  }

  return nodes.map((node) => {
    const level = depth.get(node.id) ?? 0;
    const column = columns.get(level) ?? [];
    const index = column.findIndex((item) => item.id === node.id);
    return {
      ...node,
      position: {
        x: 80 + level * columnGap,
        y: 80 + index * rowGap,
      },
    };
  });
}

function mindmapLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  const root = nodes.find(
    (node) => !edges.some((edge) => edge.target === node.id),
  ) ?? nodes[0];
  const children = edges
    .filter((edge) => edge.source === root.id)
    .map((edge) => edge.target);
  const left = children.filter((_, index) => index % 2 === 0);
  const right = children.filter((_, index) => index % 2 === 1);
  const positioned = new Map<string, { x: number; y: number }>();

  positioned.set(root.id, { x: 520, y: 280 });
  left.forEach((id, index) =>
    positioned.set(id, {
      x: 520 - NODE_WIDTH - 180,
      y: 120 + index * (NODE_HEIGHT + 50),
    }),
  );
  right.forEach((id, index) =>
    positioned.set(id, {
      x: 520 + NODE_WIDTH + 180,
      y: 120 + index * (NODE_HEIGHT + 50),
    }),
  );

  let fallback = 0;
  return nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) ?? {
      x: 520,
      y: 520 + fallback++ * 150,
    },
  }));
}
