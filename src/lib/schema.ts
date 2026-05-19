import { z } from "zod";

const nodeDataSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  kind: z
    .enum(["concept", "process", "system", "decision", "note"])
    .optional(),
  color: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const edgeDataSchema = z.object({
  label: z.string().optional(),
  kind: z.enum(["default", "dependency", "sequence", "association"]).optional(),
});

export const graphPatchSchema = z.object({
  summary: z.string().min(1),
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("addNode"),
        node: z.object({
          id: z.string().optional(),
          position: positionSchema.optional(),
          data: nodeDataSchema,
        }),
      }),
      z.object({
        type: z.literal("updateNode"),
        id: z.string(),
        data: nodeDataSchema.partial().optional(),
        position: positionSchema.optional(),
      }),
      z.object({
        type: z.literal("deleteNode"),
        id: z.string(),
      }),
      z.object({
        type: z.literal("addEdge"),
        edge: z.object({
          id: z.string().optional(),
          source: z.string(),
          target: z.string(),
          label: z.string().optional(),
          data: edgeDataSchema.optional(),
        }),
      }),
      z.object({
        type: z.literal("updateEdge"),
        id: z.string(),
        data: edgeDataSchema.partial().optional(),
        label: z.string().optional(),
      }),
      z.object({
        type: z.literal("deleteEdge"),
        id: z.string(),
      }),
      z.object({
        type: z.literal("layoutGraph"),
        mode: z.enum(["mindmap", "flow", "architecture"]),
      }),
      z.object({
        type: z.literal("setSelection"),
        nodeIds: z.array(z.string()).optional(),
        edgeIds: z.array(z.string()).optional(),
      }),
      z.object({
        type: z.literal("explain"),
        text: z.string(),
      }),
    ]),
  ),
});

export const aiChatRequestSchema = z.object({
  provider: z.enum(["custom", "mock", "deepseek"]),
  model: z.string().optional(),
  reasoningEffort: z.enum(["auto", "low", "medium", "high", "max"]).optional(),
  customProvider: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      baseUrl: z.string().min(1),
      apiKey: z.string().optional(),
    })
    .optional(),
  message: z.string().min(1),
  document: z.unknown(),
  recentMessages: z.array(z.unknown()).default([]),
  focusedNodeIds: z.array(z.string()).optional(),
  chatOnly: z.boolean().optional(),
});
