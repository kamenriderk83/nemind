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
  const root = findMindmapRoot(nodes, edges);
  const childMap = buildMindmapChildMap(nodes, edges, root.id);
  const children = childMap.get(root.id) ?? [];
  const left = children.filter((_, index) => index % 2 === 0);
  const right = children.filter((_, index) => index % 2 === 1);
  const positioned = new Map<string, { x: number; y: number }>();

  positioned.set(root.id, { x: 520, y: 280 });
  positionMindmapBranch(left, childMap, positioned, -1);
  positionMindmapBranch(right, childMap, positioned, 1);

  let fallback = 0;
  return nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) ?? {
      x: 520,
      y: 520 + fallback++ * 150,
    },
  }));
}

function findMindmapRoot(nodes: GraphNode[], edges: GraphEdge[]) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }

  return [...nodes].sort((a, b) => {
    const aRoot = incoming.get(a.id) === 0 ? 1 : 0;
    const bRoot = incoming.get(b.id) === 0 ? 1 : 0;
    if (aRoot !== bRoot) return bRoot - aRoot;
    if (aRoot === 1) return nodes.indexOf(a) - nodes.indexOf(b);
    return (outgoing.get(b.id) ?? 0) - (outgoing.get(a.id) ?? 0);
  })[0];
}

function buildMindmapChildMap(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const childMap = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    childMap.set(edge.source, [...(childMap.get(edge.source) ?? []), edge.target]);
  }

  const rootChildren = new Set(childMap.get(rootId) ?? []);
  for (const node of nodes) {
    if (node.id === rootId) continue;
    if ((incoming.get(node.id) ?? 0) === 0 && !rootChildren.has(node.id)) {
      childMap.set(rootId, [...(childMap.get(rootId) ?? []), node.id]);
    }
  }

  return childMap;
}

function positionMindmapBranch(
  ids: string[],
  childMap: Map<string, string[]>,
  positioned: Map<string, { x: number; y: number }>,
  direction: -1 | 1,
) {
  const branchGap = NODE_HEIGHT + 56;
  const totalHeight = Math.max(0, (ids.length - 1) * branchGap);
  ids.forEach((id, index) => {
    positionMindmapNode(
      id,
      childMap,
      positioned,
      direction,
      1,
      280 - totalHeight / 2 + index * branchGap,
    );
  });
}

function positionMindmapNode(
  id: string,
  childMap: Map<string, string[]>,
  positioned: Map<string, { x: number; y: number }>,
  direction: -1 | 1,
  depth: number,
  y: number,
) {
  if (positioned.has(id)) return;
  positioned.set(id, {
    x: 520 + direction * depth * (NODE_WIDTH + 170),
    y,
  });

  const children = childMap.get(id) ?? [];
  const childGap = NODE_HEIGHT + 28;
  const totalHeight = Math.max(0, (children.length - 1) * childGap);
  children.forEach((childId, index) => {
    positionMindmapNode(
      childId,
      childMap,
      positioned,
      direction,
      depth + 1,
      y - totalHeight / 2 + index * childGap,
    );
  });
}
