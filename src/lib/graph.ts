import type {
  ChatMessage,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphPatch,
} from "@/lib/types";
import { makeId } from "@/lib/ids";
import { layoutNodes } from "@/lib/layout";

const ACTION_NODE_COLOR = "#dbeafe";
const DECISION_NODE_COLOR = "#fde68a";

export function createSeedDocument(options?: { stable?: boolean }): GraphDocument {
  const now = options?.stable ? 0 : Date.now();
  return {
    id: options?.stable ? "doc-welcome" : makeId("doc"),
    title: "Untitled map",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "start",
        type: "graphNode",
        position: { x: 360, y: 240 },
        data: {
          title: "NeMind",
          body: "Start from a question, then let AI shape the map with you.",
          kind: "concept",
          color: "#d8f3dc",
        },
      },
    ],
    edges: [],
    messages: [],
  };
}

export function applyGraphPatch(
  document: GraphDocument,
  patch: GraphPatch,
): GraphDocument {
  let nodes = [...document.nodes];
  let edges = [...document.edges];

  for (const operation of patch.operations) {
    if (operation.type === "addNode") {
      const node: GraphNode = {
        id: operation.node.id ?? makeId("node"),
        type: "graphNode",
        position: operation.node.position ?? nextNodePosition(nodes),
        data: enforceKindColor(operation.node.data),
      };
      nodes = [...nodes.filter((item) => item.id !== node.id), node];
    }

    if (operation.type === "updateNode") {
      nodes = nodes.map((node) =>
        node.id === operation.id
          ? {
              ...node,
              position: operation.position ?? node.position,
              data: enforceKindColor({ ...node.data, ...operation.data }),
            }
          : node,
      );
    }

    if (operation.type === "deleteNode") {
      nodes = nodes.filter((node) => node.id !== operation.id);
      edges = edges.filter(
        (edge) => edge.source !== operation.id && edge.target !== operation.id,
      );
    }

    if (operation.type === "addEdge") {
      const edge: GraphEdge = {
        id:
          operation.edge.id ??
          `edge-${operation.edge.source}-${operation.edge.target}`,
        source: operation.edge.source,
        target: operation.edge.target,
        label: operation.edge.label,
        data: operation.edge.data,
        animated: false,
      };
      edges = [...edges.filter((item) => item.id !== edge.id), edge];
    }

    if (operation.type === "updateEdge") {
      edges = edges.map((edge) =>
        edge.id === operation.id
          ? {
              ...edge,
              label: operation.label ?? edge.label,
              data: { ...edge.data, ...operation.data },
            }
          : edge,
      );
    }

    if (operation.type === "deleteEdge") {
      edges = edges.filter((edge) => edge.id !== operation.id);
    }

    if (operation.type === "layoutGraph") {
      nodes = layoutNodes(nodes, edges, operation.mode);
    }
  }

  return {
    ...document,
    nodes,
    edges,
    updatedAt: Date.now(),
  };
}

export function addMessage(
  document: GraphDocument,
  message: Omit<ChatMessage, "id" | "createdAt">,
): GraphDocument {
  return {
    ...document,
    updatedAt: Date.now(),
    messages: [
      ...document.messages,
      {
        ...message,
        id: makeId("msg"),
        createdAt: Date.now(),
      },
    ],
  };
}

export function renameDocumentFromNode(document: GraphDocument) {
  const title = document.nodes[0]?.data.title;
  return title && document.title === "Untitled map"
    ? { ...document, title }
    : document;
}

function nextNodePosition(nodes: GraphNode[]) {
  const index = nodes.length;
  return {
    x: 120 + (index % 4) * 260,
    y: 120 + Math.floor(index / 4) * 150,
  };
}

function enforceKindColor(data: GraphNode["data"]) {
  if (data.kind === "process") return { ...data, color: ACTION_NODE_COLOR };
  if (data.kind === "decision") return { ...data, color: DECISION_NODE_COLOR };
  return data;
}
