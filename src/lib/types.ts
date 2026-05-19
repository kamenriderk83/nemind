import type { Edge, Node } from "@xyflow/react";

export type GraphNodeKind =
  | "concept"
  | "process"
  | "system"
  | "decision"
  | "note";

export type GraphNodeData = {
  title: string;
  body?: string;
  kind?: GraphNodeKind;
  color?: string;
  meta?: Record<string, unknown>;
};

export type GraphNode = Node<GraphNodeData, "graphNode">;

export type GraphEdgeData = {
  label?: string;
  kind?: "default" | "dependency" | "sequence" | "association";
};

export type GraphEdge = Edge<GraphEdgeData>;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  patch?: GraphPatch;
};

export type GraphDocument = {
  id: string;
  title: string;
  version: 1;
  createdAt: number;
  updatedAt: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  messages: ChatMessage[];
};

export type LayoutMode = "mindmap" | "flow" | "architecture";

export type GraphPatchOperation =
  | {
      type: "addNode";
      node: Partial<GraphNode> & { id?: string; data: GraphNodeData };
    }
  | {
      type: "updateNode";
      id: string;
      data?: Partial<GraphNodeData>;
      position?: { x: number; y: number };
    }
  | { type: "deleteNode"; id: string }
  | {
      type: "addEdge";
      edge: Partial<GraphEdge> & { source: string; target: string };
    }
  | {
      type: "updateEdge";
      id: string;
      data?: Partial<GraphEdgeData>;
      label?: string;
    }
  | { type: "deleteEdge"; id: string }
  | { type: "layoutGraph"; mode: LayoutMode }
  | { type: "setSelection"; nodeIds?: string[]; edgeIds?: string[] }
  | { type: "explain"; text: string };

export type GraphPatch = {
  summary: string;
  operations: GraphPatchOperation[];
};

export type AiProviderId = "custom" | "mock" | "deepseek";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

export type CustomProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
};

export type AiChatRequest = {
  provider: AiProviderId;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  customProvider?: CustomProviderConfig;
  message: string;
  document: GraphDocument;
  recentMessages: ChatMessage[];
  focusedNodeIds?: string[];
  chatOnly?: boolean;
};

export type AiChatResponse = {
  reply: string;
  patch?: GraphPatch;
  error?: string;
};
