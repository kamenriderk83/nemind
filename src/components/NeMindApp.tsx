"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  Download,
  FilePlus2,
  GitBranch,
  Hand,
  Import,
  MessageSquare,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyGraphPatch, createSeedDocument } from "@/lib/graph";
import { importTextAsGraph } from "@/lib/importers";
import { makeId } from "@/lib/ids";
import { deleteDocument, loadDocuments, saveDocument } from "@/lib/storage";
import type {
  AiChatResponse,
  AiProviderId,
  ChatMessage,
  CustomProviderConfig,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphNodeData,
  GraphPatch,
  ReasoningEffort,
} from "@/lib/types";

const nodeTypes = {
  graphNode: GraphCard,
};

type RightPanelTab = "chat" | "detail";
type SaveStatus = "saved" | "saving" | "error";
type CanvasMode = "select" | "drag";

type ModelCatalogItem = {
  id: string;
  name: string;
  provider: AiProviderId;
  model?: string;
  customProvider?: CustomProviderConfig;
};

const MODEL_STORAGE_KEY = "nemind-custom-models-v2";
const DISABLED_MODEL_STORAGE_KEY = "nemind-disabled-models-v1";
const TRASH_STORAGE_KEY = "nemind-trash-v1";
const FALLBACK_DEEPSEEK_MODELS: ModelCatalogItem[] = [
  {
    id: "official-deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    model: "deepseek-v4-flash",
  },
  {
    id: "official-deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
  },
];
function buildSeedModel(): ModelCatalogItem | null {
  const key = process.env.NEXT_PUBLIC_DEPSB_KEY;
  if (!key) return null;
  return {
    id: "seed-deepsb",
    name: "DeepSB",
    provider: "custom",
    model: "",
    customProvider: {
      id: "deepsb",
      name: "DeepSB",
      baseUrl: "https://api.deepsb.com",
      apiKey: key,
    },
  };
}
const SEED_CUSTOM_MODEL = buildSeedModel();
const DEFAULT_MODEL_ID = FALLBACK_DEEPSEEK_MODELS[0].id;
const ACTION_NODE_COLOR = "#dbeafe";
const DECISION_NODE_COLOR = "#fde68a";

function enforceKindColor(data: GraphNodeData): GraphNodeData {
  if (data.kind === "process") return { ...data, color: ACTION_NODE_COLOR };
  if (data.kind === "decision") return { ...data, color: DECISION_NODE_COLOR };
  return data;
}

export default function NeMindApp() {
  const reactFlowRef = useRef<ReactFlowInstance<GraphNode, GraphEdge> | null>(null);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const selSuppressRef = useRef(false);

  function handlePaneMouseDown(e: React.MouseEvent) {
    if (isCanvasDragMode) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(".react-flow__node") ||
      target.closest(".react-flow__edge") ||
      target.closest(".react-flow__controls") ||
      target.closest("button, input, textarea, select")
    ) {
      selStartRef.current = null;
      return;
    }
    selStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePaneMouseUp(e: React.MouseEvent) {
    if (isCanvasDragMode) {
      selStartRef.current = null;
      return;
    }
    const start = selStartRef.current;
    selStartRef.current = null;
    if (!start || !reactFlowRef.current || !document) return;

    const end = { x: e.clientX, y: e.clientY };
    if (Math.abs(end.x - start.x) < 6 && Math.abs(end.y - start.y) < 6) return;

    const isLTR = end.x >= start.x;
    const topLeft = reactFlowRef.current.screenToFlowPosition({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
    });
    const bottomRight = reactFlowRef.current.screenToFlowPosition({
      x: Math.max(start.x, end.x),
      y: Math.max(start.y, end.y),
    });
    const box = {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      x2: Math.max(topLeft.x, bottomRight.x),
      y2: Math.max(topLeft.y, bottomRight.y),
    };

    const ids: string[] = [];
    for (const n of document.nodes) {
      const w = n.measured?.width ?? 220;
      const h = n.measured?.height ?? 110;
      const nodeBox = {
        x: n.position.x,
        y: n.position.y,
        x2: n.position.x + w,
        y2: n.position.y + h,
      };

      if (isLTR) {
        if (
          nodeBox.x >= box.x &&
          nodeBox.y >= box.y &&
          nodeBox.x2 <= box.x2 &&
          nodeBox.y2 <= box.y2
        ) {
          ids.push(n.id);
        }
      } else if (
        nodeBox.x < box.x2 &&
        nodeBox.x2 > box.x &&
        nodeBox.y < box.y2 &&
        nodeBox.y2 > box.y
      ) {
        ids.push(n.id);
      }
    }

    requestAnimationFrame(() => {
      const idSet = new Set(ids);
      selSuppressRef.current = true;
      setSelectedNodeIds(ids);
      setSelectedNodeId(ids.length === 1 ? ids[0] : null);
      setDocument((cur) =>
        cur
          ? { ...cur, nodes: cur.nodes.map((n) => ({ ...n, selected: idSet.has(n.id) })) }
          : cur,
      );
      setTimeout(() => { selSuppressRef.current = false; }, 100);
    });
  }

  function handleCanvasWheelCapture(e: React.WheelEvent) {
    if (!reactFlowRef.current || !isLikelyTrackpadPan(e)) return;

    e.preventDefault();
    e.stopPropagation();
    const viewport = reactFlowRef.current.getViewport();
    void reactFlowRef.current.setViewport(
      {
        x: viewport.x - e.deltaX,
        y: viewport.y - e.deltaY,
        zoom: viewport.zoom,
      },
      { duration: 0 },
    );
  }
  const [documents, setDocuments] = useState<GraphDocument[]>(() => [
    createSeedDocument({ stable: true }),
  ]);
  const [document, setDocument] = useState<GraphDocument | null>(() =>
    createSeedDocument({ stable: true }),
  );
  const [trashItems, setTrashItems] = useState<GraphDocument[]>(readTrash);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [officialModels, setOfficialModels] =
    useState<ModelCatalogItem[]>(FALLBACK_DEEPSEEK_MODELS);
  const [userModels, setUserModels] =
    useState<ModelCatalogItem[]>(readStoredUserModels);
  const [disabledModelIds, setDisabledModelIds] =
    useState<string[]>(readDisabledModelIds);
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("auto");
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isReasoningMenuOpen, setIsReasoningMenuOpen] = useState(false);
  const [isModelManagerOpen, setIsModelManagerOpen] = useState(false);
  const [modelManagerMode, setModelManagerMode] =
    useState<"models" | "providers" | "custom">("models");
  const [modelSearch, setModelSearch] = useState("");
  const [draftConnectorJson, setDraftConnectorJson] = useState("");
  const [draftProviderId, setDraftProviderId] = useState("myprovider");
  const [draftModelName, setDraftModelName] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftModelId, setDraftModelId] = useState("");
  const [draftModelOptions, setDraftModelOptions] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelLoadError, setModelLoadError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [pendingPatch, setPendingPatch] = useState<GraphPatch | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingChatDocumentId, setPendingChatDocumentId] = useState<string | null>(null);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(true);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [isChatOnlyMode, setIsChatOnlyMode] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("select");
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>("chat");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [history, setHistory] = useState<GraphDocument[]>([]);
  const [future, setFuture] = useState<GraphDocument[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatTextRef = useRef<HTMLTextAreaElement | null>(null);
  const isCanvasDragMode = canvasMode === "drag" || isSpacePanning;

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element?.closest("input, textarea, select, [contenteditable='true']"),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isEditableTarget(event.target)) return;
      event.preventDefault();
      setIsSpacePanning(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setIsSpacePanning(false);
    };
    const handleBlur = () => setIsSpacePanning(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      loadDocuments().then((stored) => {
        if (!stored.length) return;
        const renamed = disambiguateDocumentTitles(stored);
        setDocuments((prev) => {
          const merged = new Map(prev.map((d) => [d.id, d]));
          for (const d of renamed) merged.set(d.id, d);
          for (const local of prev) {
            const server = merged.get(local.id);
            if (server && server.updatedAt < local.updatedAt) merged.set(local.id, local);
            if (!server) merged.set(local.id, local);
          }
          const list = [...merged.values()];
          list.sort((a, b) => b.updatedAt - a.updatedAt);
          return list;
        });
        setDocument((cur) => {
          if (!cur) return renamed[0];
          const updated = renamed.find((d) => d.id === cur.id);
          return updated && updated.updatedAt > cur.updatedAt ? updated : cur;
        });
      }).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    loadDocuments().then((stored) => {
      if (stored.length) {
        const renamed = disambiguateDocumentTitles(stored);
        setDocuments(renamed);
        setDocument(renamed[0]);
        renamed.forEach((item) => void saveDocument(item, { touch: false }));
        return;
      }

      setDocuments((items) => items);
      setDocument((current) => {
        if (current) void saveDocument(current, { touch: false });
        return current;
      });
    });
  }, []);

  useEffect(() => {
    fetch("/api/models-config")
      .then((r) => r.json())
      .then((data: { models?: ModelCatalogItem[] }) => {
        const serverModels = (data.models ?? []).filter((m) => m.provider === "custom");
        if (serverModels.length) {
          setUserModels((local) => {
            const merged = [...local];
            for (const sm of serverModels) {
              if (!merged.some((m) => m.id === sm.id)) merged.push(sm);
            }
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(userModels));
    const customs = userModels.filter((m) => m.provider === "custom");
    fetch("/api/models-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: customs }),
    }).catch(() => {});
  }, [userModels]);

  useEffect(() => {
    window.localStorage.setItem(DISABLED_MODEL_STORAGE_KEY, JSON.stringify(disabledModelIds));
  }, [disabledModelIds]);

  useEffect(() => {
    fetch("/api/ai/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek" }),
    })
      .then((response) => response.json())
      .then((result: { models?: string[] }) => {
        const models = (result.models ?? []).filter(Boolean);
        if (!models.length) return;
        setOfficialModels(models.map(createOfficialDeepSeekModel));
      })
      .catch(() => {
        setOfficialModels(FALLBACK_DEEPSEEK_MODELS);
      });
  }, []);

  useEffect(() => {
    const unexpanded = userModels.filter(
      (m) => m.provider === "custom" && m.customProvider && !m.model,
    );
    if (!unexpanded.length) return;

    Promise.allSettled(
      unexpanded.map((m) =>
        fetch("/api/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "custom",
            customProvider: m.customProvider,
          }),
        }).then((r) => r.json() as Promise<{ models?: string[] }>),
      ),
    ).then((results) => {
      const expanded: ModelCatalogItem[] = [];
      results.forEach((result, i) => {
        if (result.status !== "fulfilled") return;
        const models = (result.value.models ?? []).filter(Boolean);
        const config = unexpanded[i].customProvider!;
        if (models.length) {
          models.forEach((model) => {
            expanded.push({
              id: createCustomModelId(config.id, model),
              name: `${config.name} / ${model}`,
              provider: "custom",
              model,
              customProvider: config,
            });
          });
        }
      });
      if (expanded.length) {
        setUserModels((prev) => {
          const withoutUnexpanded = prev.filter(
            (m) => !unexpanded.some((u) => u.id === m.id),
          );
          return upsertCustomModels(withoutUnexpanded, expanded);
        });
      }
    });
  }, [userModels]);

  useEffect(() => {
    if (!document) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus("saving");
      void saveDocument(document)
        .then(() => {
          setSaveStatus("saved");
          setLastSavedAt(Date.now());
        })
        .catch(() => setSaveStatus("error"));
      setDocuments((items) =>
        [document, ...items.filter((item) => item.id !== document.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
    }, 350);
  }, [document]);

  useEffect(() => {
    if (!projectMenu) return;

    const closeMenu = () => setProjectMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [projectMenu]);

  useEffect(() => {
    if (!isModelMenuOpen) return;

    const closeMenu = () => setIsModelMenuOpen(false);
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [isModelMenuOpen]);

  const selectedNode = useMemo(
    () => document?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [document, selectedNodeId],
  );
  const actionNodes = useMemo(
    () =>
      (document?.nodes ?? [])
        .filter((node) => node.data.kind === "process")
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
    [document?.nodes],
  );
  const decisionNodes = useMemo(
    () =>
      (document?.nodes ?? [])
        .filter((node) => node.data.kind === "decision")
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
    [document?.nodes],
  );
  const currentDocumentStats = useMemo(
    () => getDocumentStats(document),
    [document],
  );
  const visibleEdges = useMemo(
    () => orientEdgesByNodePosition(document?.nodes ?? [], document?.edges ?? []),
    [document?.edges, document?.nodes],
  );

  const disabledModelSet = useMemo(() => new Set(disabledModelIds), [disabledModelIds]);
  const allModels = useMemo(
    () => [...officialModels, ...userModels].filter((m) => m.model),
    [officialModels, userModels],
  );
  const selectableModels = useMemo(
    () => allModels.filter((model) => !disabledModelSet.has(model.id)),
    [allModels, disabledModelSet],
  );
  const selectedModel =
    selectableModels.find((model) => model.id === selectedModelId) ??
    selectableModels[0] ??
    FALLBACK_DEEPSEEK_MODELS[0];
  const effectiveSelectedModelId = selectedModel?.id ?? "";
  const selectedModelName =
    selectedModel.provider === "custom"
      ? selectedModel.model || selectedModel.name
      : selectedModel.name;
  const selectedModelSource =
    selectedModel.provider === "deepseek"
      ? "官方 DeepSeek"
      : selectedModel.customProvider?.name || "自定义接口";

  const groupedSelectableUserModels = useMemo(() => {
    const groups = new Map<string, ModelCatalogItem[]>();
    for (const m of selectableModels) {
      if (m.provider !== "custom") continue;
      if (!m.model) continue;
      const key = m.customProvider?.name || "其他";
      const list = groups.get(key);
      if (list) list.push(m);
      else groups.set(key, [m]);
    }
    return groups;
  }, [selectableModels]);

  const filteredManagedModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return allModels.filter(
      (model) =>
        model.model &&
        (!query ||
          model.name.toLowerCase().includes(query) ||
          (model.customProvider?.name ?? "").toLowerCase().includes(query) ||
          model.provider.toLowerCase().includes(query) ||
          model.model.toLowerCase().includes(query)),
    );
  }, [allModels, modelSearch]);

  const managedModelGroups = useMemo(() => {
    const groups = new Map<string, ModelCatalogItem[]>();
    for (const model of filteredManagedModels) {
      const key =
        model.provider === "deepseek"
          ? "DeepSeek"
          : model.customProvider?.name || model.name || "自定义";
      const list = groups.get(key);
      if (list) list.push(model);
      else groups.set(key, [model]);
    }
    return groups;
  }, [filteredManagedModels]);

  const customModelLookup = useMemo(() => {
    const lookup = new Set<string>();
    for (const model of userModels) {
      if (model.provider !== "custom" || !model.customProvider || !model.model) continue;
      lookup.add(modelKey(model.customProvider.id, model.model));
    }
    return lookup;
  }, [userModels]);

  const mutateDocument = useCallback(
    (
      updater: (current: GraphDocument) => GraphDocument,
      options: { recordHistory?: boolean } = { recordHistory: true },
    ) => {
      setDocument((current) => {
        if (!current) return current;
        if (options.recordHistory) {
          setHistory((items) => [...items.slice(-24), current]);
          setFuture([]);
        }
        return {
          ...updater(current),
          updatedAt: Date.now(),
        };
      });
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<GraphNode>[]) => {
      mutateDocument((current) => ({
        ...current,
        nodes: applyNodeChanges(changes, current.nodes),
      }));
    },
    [mutateDocument],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<GraphEdge>[]) => {
      mutateDocument((current) => ({
        ...current,
        edges: applyEdgeChanges(changes, current.edges),
      }));
    },
    [mutateDocument],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      mutateDocument((current) => ({
        ...current,
        edges: addEdge(
          {
            ...orientConnectionByNodePosition(current.nodes, connection),
            id: `edge-${connection.source}-${connection.target}-${makeId("link")}`,
          },
          current.edges,
        ),
      }));
    },
    [mutateDocument],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams<GraphNode, GraphEdge>) => {
      if (selSuppressRef.current) return;
      setSelectedNodeId(nodes[0]?.id ?? null);
      setSelectedNodeIds(nodes.map((n) => n.id));
    },
    [],
  );

  function focusGraphNode(node: GraphNode) {
    setSelectedNodeId(node.id);
    setSelectedNodeIds([node.id]);
    const width = node.measured?.width ?? 220;
    const height = node.measured?.height ?? 110;
    reactFlowRef.current?.setCenter(
      node.position.x + width / 2,
      node.position.y + height / 2,
      { zoom: 1.05, duration: 360 },
    );
  }

  function draftActionDecisionPrompt() {
    setChatInput("只分析当前导图，列出候选行动项和候选决策点，不要修改导图，也不要新增卡片。");
    setIsChatOnlyMode(true);
    setRightTab("chat");
    window.setTimeout(() => chatTextRef.current?.focus(), 0);
  }

  function draftNextLinePrompt() {
    setChatInput(
      selectedNodeIds.length
        ? "沿着选中的节点继续，只展开下一条线或一个分支，最多新增 3 个节点。"
        : "沿着当前导图继续，只展开下一条线或一个分支，最多新增 3 个节点。",
    );
    setIsChatOnlyMode(false);
    setRightTab("chat");
    window.setTimeout(() => chatTextRef.current?.focus(), 0);
  }

  function draftStructureTidyPrompt() {
    setChatInput("重新整理当前导图结构：传统导图只保留一个中心主题，分支清晰连接，不新增无关内容。");
    setIsChatOnlyMode(false);
    setRightTab("chat");
    window.setTimeout(() => chatTextRef.current?.focus(), 0);
  }

  function newDocument() {
    const next = createSeedDocument();
    next.title = nextUntitledTitle(documents);
    setHistory([]);
    setFuture([]);
    setPendingPatch(null);
    setDocument(next);
    setDocuments((items) => [next, ...items]);
    void saveDocument(next);
  }

  function updateSelectedNode(data: Partial<GraphNodeData>) {
    if (!selectedNodeId) return;
    mutateDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: enforceKindColor({ ...node.data, ...data }) }
          : node,
      ),
    }));
  }

  function renameDocument(id: string, title: string) {
    const nextTitle = title.trimStart();
    setDocuments((items) =>
      items.map((item) =>
        item.id === id ? { ...item, title: nextTitle } : item,
      ),
    );
    setDocument((current) =>
      current?.id === id ? { ...current, title: nextTitle } : current,
    );
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(TRASH_STORAGE_KEY, JSON.stringify(trashItems));
    } catch { /* noop */ }
  }, [trashItems]);

  function removeDocument(id: string) {
    const target = documents.find((item) => item.id === id);
    if (!target) return;
    setTrashItems((items) => [
      { ...target, updatedAt: Date.now() },
      ...items.filter((t) => t.id !== id),
    ]);
    const remaining = documents.filter((item) => item.id !== id);
    const fallback = createSeedDocument();
    const nextDocuments = remaining.length ? remaining : [fallback];
    setDocuments(nextDocuments);
    if (document?.id === id) {
      setDocument(nextDocuments[0]);
      setHistory([]);
      setFuture([]);
      setPendingPatch(null);
    }
    setProjectMenu(null);
  }

  function restoreDocument(id: string) {
    const target = trashItems.find((item) => item.id === id);
    if (!target) return;
    setTrashItems((items) => items.filter((t) => t.id !== id));
    setDocuments((items) => [target, ...items]);
  }

  function permanentDelete(id: string) {
    void deleteDocument(id);
    setTrashItems((items) => items.filter((t) => t.id !== id));
  }

  function emptyTrash() {
    for (const item of trashItems) void deleteDocument(item.id);
    setTrashItems([]);
  }

  function connectModel() {
    const providerId = draftProviderId.trim().toLowerCase();
    const baseUrl = draftBaseUrl.trim();
    const model = draftModelId.trim();
    const providerName = draftModelName.trim() || "我的 AI 提供商";
    if (!providerId || !baseUrl || !model) return;

    const id = createCustomModelId(providerId, model);
    const nextModel: ModelCatalogItem = {
      id,
      name: providerName,
      provider: "custom",
      model,
      customProvider: {
        id: providerId,
        name: providerName,
        baseUrl,
        apiKey: draftApiKey.trim() || undefined,
      },
    };

    setUserModels((models) => upsertCustomModels(models, [nextModel]));
    setDisabledModelIds((current) => current.filter((modelId) => modelId !== id));
    setSelectedModelId(id);
    resetModelDraft();
    setModelLoadError("");
  }

  function connectAllLoadedModels() {
    const providerId = draftProviderId.trim().toLowerCase();
    const baseUrl = draftBaseUrl.trim();
    const providerName = draftModelName.trim() || "我的 AI 提供商";
    const models = draftModelOptions.map((model) => model.trim()).filter(Boolean);
    if (!providerId || !baseUrl || !models.length) return;

    const nextModels = models.map((model) => ({
      id: createCustomModelId(providerId, model),
      name: providerName,
      provider: "custom" as const,
      model,
      customProvider: {
        id: providerId,
        name: providerName,
        baseUrl,
        apiKey: draftApiKey.trim() || undefined,
      },
    }));

    setUserModels((current) => upsertCustomModels(current, nextModels));
    setDisabledModelIds((current) =>
      current.filter((id) => !nextModels.some((model) => model.id === id)),
    );
    setSelectedModelId(nextModels[0].id);
    resetModelDraft();
    setModelLoadError("");
    setModelManagerMode("models");
  }

  function resetModelDraft() {
    setDraftProviderId("myprovider");
    setDraftModelName("");
    setDraftBaseUrl("");
    setDraftApiKey("");
    setDraftModelId("");
    setDraftModelOptions([]);
    setDraftConnectorJson("");
  }

  function openModelManager(mode: "models" | "providers" | "custom" = "models") {
    setModelManagerMode(mode);
    setIsModelMenuOpen(false);
    setIsModelManagerOpen(true);
  }

  function applyConnectorJson(value: string) {
    setDraftConnectorJson(value);
    if (!value.trim()) return;

    try {
      const parsed = JSON.parse(value) as {
        key?: unknown;
        url?: unknown;
        id?: unknown;
        name?: unknown;
      };
      if (typeof parsed.url === "string") setDraftBaseUrl(parsed.url);
      if (typeof parsed.key === "string") setDraftApiKey(parsed.key);
      if (typeof parsed.id === "string") setDraftProviderId(parsed.id);
      if (typeof parsed.name === "string") setDraftModelName(parsed.name);
      if (!("name" in parsed)) setDraftModelName("自定义接口");
      setModelLoadError("");

      void loadModelsOnly({
        baseUrl: typeof parsed.url === "string" ? parsed.url : "",
        apiKey: typeof parsed.key === "string" ? parsed.key : "",
        providerId: typeof parsed.id === "string" ? parsed.id : "myprovider",
        providerName: typeof parsed.name === "string" ? parsed.name : "自定义接口",
      });
    } catch {
      setModelLoadError("连接 JSON 格式不对。");
    }
  }

  async function loadModelsOnly(params: {
    baseUrl: string;
    apiKey: string;
    providerId: string;
    providerName: string;
  }) {
    const { baseUrl, apiKey, providerId, providerName } = params;
    if (!baseUrl) {
      setModelLoadError("先填写 Base URL。");
      return;
    }

    setIsLoadingModels(true);
    setModelLoadError("");
    try {
      const response = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "custom",
          customProvider: {
            id: providerId || "custom",
            name: providerName,
            baseUrl,
            apiKey: apiKey || undefined,
          },
        }),
      });
      const result = (await response.json()) as {
        models?: string[];
        error?: string;
      };
      if (!response.ok || result.error) {
        setModelLoadError(result.error ?? "模型列表获取失败。");
        return;
      }

      const models = result.models ?? [];
      setDraftModelOptions(models);
      setDraftModelId((current) => {
        if (!models.length) return current;
        return models.includes(current) ? current : models[0];
      });
      setModelLoadError(
        models.length
          ? `已获取 ${models.length} 个模型，选择一个后点击连接。`
          : "没有从接口拿到模型，可以手动填写模型 ID。",
      );
    } finally {
      setIsLoadingModels(false);
    }
  }

  function removeModel(id: string) {
    setUserModels((models) => {
      const nextModels = models.filter((model) => model.id !== id);
      if (selectedModelId === id) {
        const nextModel = nextModels.find((model) => model.model);
        setSelectedModelId(nextModel?.id ?? DEFAULT_MODEL_ID);
      }
      return nextModels;
    });
  }

  function toggleModelEnabled(modelId: string) {
    setDisabledModelIds((current) => {
      const isDisabled = current.includes(modelId);
      return isDisabled ? current.filter((id) => id !== modelId) : [...current, modelId];
    });
  }

  async function sendChat() {
    const message = (chatInput || chatTextRef.current?.value || "").trim();
    if (!document || !message || isSending) return;
    if (!selectedModel) {
      openModelManager("models");
      return;
    }
    const requestDocument = document;
    const requestDocumentId = document.id;
    const requestFocusedNodeIds = selectedNodeIds.length > 0
      ? selectedNodeIds
      : requestDocument.nodes.map((n) => n.id);
    const userMessage = {
      id: makeId("msg"),
      role: "user" as const,
      content: message,
      createdAt: Date.now(),
    };
    const requestDocumentWithUserMessage = {
      ...requestDocument,
      messages: [...requestDocument.messages, userMessage],
      updatedAt: Date.now(),
    };
    setChatInput("");
    if (chatTextRef.current) chatTextRef.current.value = "";
    setIsSending(true);
    setPendingChatDocumentId(requestDocumentId);

    setDocument((current) =>
      current?.id === requestDocumentId
        ? requestDocumentWithUserMessage
        : current,
    );
    setDocuments((items) =>
      [requestDocumentWithUserMessage, ...items.filter((item) => item.id !== requestDocumentId)]
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
    void saveDocument(requestDocumentWithUserMessage, { touch: false });

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          model: selectedModel.model,
          reasoningEffort,
          customProvider: selectedModel.customProvider,
          message,
          document: requestDocument,
          recentMessages: requestDocument.messages.slice(-8),
          focusedNodeIds: requestFocusedNodeIds,
          chatOnly: isChatOnlyMode,
        }),
      });
      const result = (await response.json()) as AiChatResponse;

      const assistantMessage = {
        id: makeId("msg"),
        role: "assistant" as const,
        content: result.error
          ? `${result.reply}\n\n${result.error}`
          : result.reply,
        createdAt: Date.now(),
        patch: result.patch ?? undefined,
      };
      let patchedActiveDocument = false;
      const applyAssistantResult = (current: GraphDocument) => {
        let next = {
          ...current,
          messages: [...current.messages, assistantMessage],
          updatedAt: Date.now(),
        };
        if (result.patch) {
          next = applyGraphPatch(next, result.patch);
        }
        return next;
      };
      const completedRequestDocument = applyAssistantResult(requestDocumentWithUserMessage);

      setDocuments((items) =>
        [completedRequestDocument, ...items.filter((item) => item.id !== requestDocumentId)]
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
      setDocument((current) => {
        if (!current || current.id !== requestDocumentId) return current;
        if (result.patch) {
          setHistory((items) => [...items.slice(-24), current]);
          setFuture([]);
          patchedActiveDocument = true;
        }
        return applyAssistantResult(current);
      });
      void saveDocument(completedRequestDocument, { touch: false });
      setPendingPatch(null);

      if (result.patch && patchedActiveDocument) {
        setTimeout(() => reactFlowRef.current?.fitView({ duration: 400 }), 50);
      }
    } catch (err) {
      const errorMessage = {
        id: makeId("msg"),
        role: "assistant" as const,
        content: `网络请求失败: ${err instanceof Error ? err.message : "未知错误"}`,
        createdAt: Date.now(),
      };
      const failedRequestDocument = {
        ...requestDocumentWithUserMessage,
        messages: [...requestDocumentWithUserMessage.messages, errorMessage],
        updatedAt: Date.now(),
      };
      setDocuments((items) =>
        [failedRequestDocument, ...items.filter((item) => item.id !== requestDocumentId)]
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
      setDocument((current) =>
        current?.id === requestDocumentId
          ? failedRequestDocument
          : current,
      );
      void saveDocument(failedRequestDocument, { touch: false });
    } finally {
      setIsSending(false);
      setPendingChatDocumentId(null);
    }
  }

  function applyPendingPatch() {
    if (!pendingPatch) return;
    mutateDocument((current) => applyGraphPatch(current, pendingPatch));
    setPendingPatch(null);
  }

  function undo() {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous || !document) return items;
      setFuture((futureItems) => [document, ...futureItems]);
      setDocument(previous);
      return items.slice(0, -1);
    });
  }

  function redo() {
    setFuture((items) => {
      const next = items[0];
      if (!next || !document) return items;
      setHistory((historyItems) => [...historyItems, document]);
      setDocument(next);
      return items.slice(1);
    });
  }

  function runImport() {
    const result = importTextAsGraph(importText);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setHistory(document ? [document] : []);
    setFuture([]);
    setPendingPatch(null);
    setDocument(result.document);
    setDocuments((items) => [result.document, ...items]);
    setImportText("");
    setImportError("");
    setIsImportOpen(false);
  }

  function exportJson() {
    if (!document) return;
    const blob = new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.title.replace(/[^a-z0-9_-]+/gi, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as GraphDocument;
        const next = { ...parsed, updatedAt: Date.now() };
        setDocument(next);
        setDocuments((items) => [next, ...items.filter((item) => item.id !== next.id)]);
      } catch {
        setImportError("JSON import failed. The file does not look like a NeMind document.");
      }
    };
    reader.readAsText(file);
  }

  if (!document) {
    return <main className="loading">Opening NeMind...</main>;
  }

  return (
    <main
      className={[
        "app-shell",
        isLeftCollapsed ? "left-collapsed" : "",
        isRightCollapsed ? "right-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <aside className="project-rail">
        <div className="brand">
          <GitBranch size={20} />
          {isLeftCollapsed ? null : <span>NeMind</span>}
          <button
            className="rail-toggle"
            title={isLeftCollapsed ? "Expand project rail" : "Collapse project rail"}
            onPointerDown={(event) => {
              event.preventDefault();
              setIsLeftCollapsed((value) => !value);
            }}
          >
            {isLeftCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
        </div>
        {isLeftCollapsed ? (
          <button className="rail-icon-action" title="New map" onClick={newDocument}>
            <FilePlus2 size={17} />
          </button>
        ) : (
          <>
            <button className="primary-action" onClick={newDocument}>
              <FilePlus2 size={16} />
              New map
            </button>
            <div className="project-list">
              {documents.map((item) => (
                <div
                  className={item.id === document.id ? "project active" : "project"}
                  key={item.id}
                  onClick={() => {
                    setDocument(item);
                    setHistory([]);
                    setFuture([]);
                    setPendingPatch(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDocument(item);
                    setProjectMenu({
                      id: item.id,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  <input
                    className="project-title-edit"
                    value={item.title}
                    onChange={(event) => renameDocument(item.id, event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => {
                      setDocument(item);
                      setHistory([]);
                      setFuture([]);
                      setPendingPatch(null);
                    }}
                    onBlur={() => {
                      const fallback = item.title.trim() || nextUntitledTitle(documents);
                      renameDocument(item.id, fallback);
                    }}
                  />
                  <small>
                    {projectStatsLine(item)} · {relativeTime(item.updatedAt)}
                  </small>
                </div>
              ))}
            </div>
            <div className="trash-section">
              <div className="trash-header">
                <span>回收站 ({trashItems.length})</span>
                {trashItems.length > 0 ? (
                  <button className="trash-empty-btn" onClick={emptyTrash}>
                    清空
                  </button>
                ) : null}
              </div>
              {trashItems.length ? (
                trashItems.map((item) => (
                  <div className="project trash-item" key={item.id}>
                    <span className="trash-title">{item.title || "Untitled"}</span>
                    <small>{relativeTime(item.updatedAt)}</small>
                    <div className="trash-actions">
                      <button
                        title="恢复"
                        onClick={(e) => { e.stopPropagation(); restoreDocument(item.id); }}
                      >
                        恢复
                      </button>
                      <button
                        className="trash-delete-btn"
                        title="彻底删除"
                        onClick={(e) => { e.stopPropagation(); permanentDelete(item.id); }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="trash-empty">回收站为空</div>
              )}
            </div>
          </>
        )}
      </aside>

      {projectMenu ? (
        <div
          className="context-menu"
          style={{ left: projectMenu.x, top: projectMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="context-danger" onClick={() => removeDocument(projectMenu.id)}>
            <Trash2 size={15} />
            Delete map
          </button>
        </div>
      ) : null}

      <aside className="decision-action-panel">
        <div className="decision-action-summary">
          <div>
            <span>当前导图</span>
            <strong>{currentDocumentStats.total}</strong>
          </div>
          <div>
            <span>行动</span>
            <strong>{currentDocumentStats.actions}</strong>
          </div>
          <div>
            <span>决策</span>
            <strong>{currentDocumentStats.decisions}</strong>
          </div>
        </div>
        <ActionDecisionSection
          title="行动"
          count={actionNodes.length}
          nodes={actionNodes}
          emptyText="当前导图还没有行动节点"
          actionText="找候选行动"
          selectedNodeId={selectedNodeId}
          onSelectNode={focusGraphNode}
          onDraft={draftActionDecisionPrompt}
        />
        <ActionDecisionSection
          title="决策"
          count={decisionNodes.length}
          nodes={decisionNodes}
          emptyText="当前导图还没有决策节点"
          actionText="找候选决策"
          selectedNodeId={selectedNodeId}
          onSelectNode={focusGraphNode}
          onDraft={draftActionDecisionPrompt}
        />
      </aside>

      <section className="canvas-column">
        <header className="topbar">
          <div className="title-stack">
            <input
              className="title-input"
              value={document.title}
              onChange={(event) =>
                mutateDocument(
                  (current) => ({ ...current, title: event.target.value }),
                  { recordHistory: false },
                )
              }
            />
            <span className={`save-status ${saveStatus}`}>
              {saveStatus === "saving"
                ? "自动保存中"
                : saveStatus === "error"
                  ? "保存失败，已保留本机备份"
                  : lastSavedAt
                    ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "已保存"}
            </span>
          </div>
          <div className="toolbar">
            <div className="canvas-mode-switch" title="画布模式">
              <button
                type="button"
                className={canvasMode === "select" && !isSpacePanning ? "active" : ""}
                title="框选模式"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setCanvasMode("select");
                }}
                onClick={() => setCanvasMode("select")}
              >
                <MousePointer2 size={15} />
              </button>
              <button
                type="button"
                className={isCanvasDragMode ? "active" : ""}
                title="拖动模式：左键拖动画布，不框选"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setCanvasMode("drag");
                }}
                onClick={() => setCanvasMode("drag")}
              >
                <Hand size={15} />
              </button>
            </div>
            <button title="Undo" disabled={!history.length} onClick={undo}>
              <RotateCcw size={16} />
            </button>
            <button title="Redo" disabled={!future.length} onClick={redo}>
              <RotateCw size={16} />
            </button>
            <button title="Import text" onClick={() => setIsImportOpen((value) => !value)}>
              <Import size={16} />
            </button>
            <label className="icon-upload" title="Import JSON">
              <Import size={16} />
              <input
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importJson(file);
                }}
              />
            </label>
            <button title="Export JSON" onClick={exportJson}>
              <Download size={16} />
            </button>
          </div>
        </header>

        {isImportOpen ? (
          <div className="import-panel">
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={"flowchart LR\n  A[Idea] --> B[Plan]\n\n- Product\n  - Chat\n  - Canvas"}
            />
            <div>
              <button className="primary-action compact" onClick={runImport}>
                Import
              </button>
              {importError ? <span className="inline-error">{importError}</span> : null}
            </div>
          </div>
        ) : null}

        <div
          className={`canvas-wrap ${isCanvasDragMode ? "drag-mode" : "select-mode"}`}
          onMouseDown={handlePaneMouseDown}
          onMouseUp={handlePaneMouseUp}
          onWheelCapture={handleCanvasWheelCapture}
        >
          <ReactFlow
            nodes={document.nodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onInit={(instance) => { reactFlowRef.current = instance; }}
            selectionOnDrag={!isCanvasDragMode}
            panOnDrag={isCanvasDragMode ? [0, 1, 2] : [1, 2]}
            panOnScroll={false}
            zoomOnScroll
            zoomOnPinch
            preventScrolling
            panActivationKeyCode={null}
            selectionKeyCode={!isCanvasDragMode ? "Shift" : null}
            multiSelectionKeyCode={!isCanvasDragMode ? "Shift" : null}
            fitView
          >
            <Background color="#cbd5e1" gap={18} />
            <Controls />
          </ReactFlow>
        </div>
      </section>

      <aside className={`side-panel ${rightTab === "chat" ? "tab-chat" : "tab-detail"}`}>
        <div className="side-header">
          <div className="panel-tabs">
            <button
              className={rightTab === "chat" ? "tab-button active" : "tab-button"}
              onClick={() => setRightTab("chat")}
            >
              <MessageSquare size={15} />
              AI Chat
            </button>
            <button
              className={rightTab === "detail" ? "tab-button active" : "tab-button"}
              onClick={() => setRightTab("detail")}
            >
              <GitBranch size={15} />
              Node Detail
              {selectedNode ? <span className="tab-dot" /> : null}
            </button>
          </div>
          <button
            className={isChatOnlyMode ? "mode-toggle-btn active" : "mode-toggle-btn"}
            onClick={() => setIsChatOnlyMode((v) => !v)}
            title={isChatOnlyMode ? "当前：纯聊天，不更新画布" : "当前：对话 + 更新画布"}
          >
            <MessageSquare size={15} />
            {isChatOnlyMode ? "Chat" : "Map"}
          </button>
          <button
            className="rail-toggle"
            title={isRightCollapsed ? "Expand AI panel" : "Collapse AI panel"}
            onClick={() => setIsRightCollapsed((value) => !value)}
          >
            {isRightCollapsed ? (
              <PanelRightOpen size={16} />
            ) : (
              <PanelRightClose size={16} />
            )}
          </button>
        </div>
        <section className="panel-block chat-block">
          <div className="model-picker-row">
            <div
              className="model-menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="model-trigger"
                onClick={() => {
                  setIsReasoningMenuOpen(false);
                  setIsModelMenuOpen((value) => !value);
                }}
                title={`${selectedModelName} · ${selectedModelSource}`}
              >
                <Sparkles size={14} />
                <span className="model-trigger-text">
                  {selectedModelName}
                </span>
                <ChevronDown size={14} />
              </button>
              {isModelMenuOpen ? (
                <div className="model-popover">
                  <div className="model-popover-tools">
                    <label className="model-search compact">
                      <Search size={15} />
                      <input
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="搜索模型"
                      />
                    </label>
                    <button title="连接提供商" onClick={() => openModelManager("providers")}>
                      <Plus size={15} />
                    </button>
                    <button title="管理模型" onClick={() => openModelManager("models")}>
                      <SlidersHorizontal size={15} />
                    </button>
                  </div>
                  <div className="model-popover-header">DeepSeek</div>
                  {officialModels.filter((model) => !disabledModelSet.has(model.id)).map((model) => (
                    <button
                      className={
                        effectiveSelectedModelId === model.id
                          ? "model-option active"
                          : "model-option"
                      }
                      key={model.id}
                      onClick={() => {
                        setSelectedModelId(model.id);
                        setIsModelMenuOpen(false);
                      }}
                      >
                        <span>
                          <strong>{model.name}</strong>
                          <small>{model.model}</small>
                        </span>
                        {effectiveSelectedModelId === model.id ? <Check size={15} /> : null}
                      </button>
                  ))}
                  {groupedSelectableUserModels.size > 0
                    ? [...groupedSelectableUserModels.entries()].map(([providerName, models]) => (
                        <div key={providerName}>
                          <div className="model-popover-header">{providerName}</div>
                          {models.map((model) => (
                            <button
                              className={
                                effectiveSelectedModelId === model.id
                                  ? "model-option active"
                                  : "model-option"
                              }
                              key={model.id}
                              onClick={() => {
                                setSelectedModelId(model.id);
                                setIsModelMenuOpen(false);
                              }}
                            >
                              <span>
                                <strong>{model.model}</strong>
                                <small>{providerName}</small>
                              </span>
                              {effectiveSelectedModelId === model.id ? <Check size={15} /> : null}
                            </button>
                          ))}
                        </div>
                      ))
                    : null}
                  {!selectableModels.length ? (
                    <p className="empty-models popover-empty">没有启用的模型。</p>
                  ) : null}
                  <button
                    className="model-option muted-option"
                    onClick={() => {
                      setIsModelMenuOpen(false);
                      openModelManager("providers");
                    }}
                  >
                    <span>
                      <strong>连接新的接口</strong>
                      <small>粘贴 NewAPI / OpenAI-compatible 配置</small>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <div
              className="reasoning-menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="reasoning-trigger"
                title="思考强度"
                onClick={() => {
                  setIsModelMenuOpen(false);
                  setIsReasoningMenuOpen((value) => !value);
                }}
              >
                <Brain size={14} />
                <span>{reasoningLabel(reasoningEffort)}</span>
                <ChevronDown size={13} />
              </button>
              {isReasoningMenuOpen ? (
                <div className="reasoning-popover">
                  {(["auto", "low", "medium", "high", "max"] as ReasoningEffort[]).map(
                    (value) => (
                      <button
                        className={reasoningEffort === value ? "active" : ""}
                        key={value}
                        onClick={() => {
                          setReasoningEffort(value);
                          setIsReasoningMenuOpen(false);
                        }}
                      >
                        <span>{reasoningLabel(value)}</span>
                        {reasoningEffort === value ? <Check size={14} /> : null}
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="messages">
            {document.messages.length || pendingChatDocumentId === document.id ? (
              document.messages.map((message, index) => (
                <div className={`message ${message.role}`} key={message.id}>
                  <div className="message-content">
                    {message.role === "assistant" ? (
                      <div className="message-run-status">
                        {messageRunStatus(message, document.messages, index)}
                      </div>
                    ) : null}
                    <p>{message.content}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Bot size={22} />
                Ask for a flow, architecture map, or outline.
              </div>
            )}
            {pendingChatDocumentId === document.id ? (
              <div className="message assistant pending">
                <div className="message-content">
                  <div className="message-run-status active">
                    <span className="thinking-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    思考中
                  </div>
                  <p>思考中，正在生成回复...</p>
                </div>
              </div>
            ) : null}
          </div>
          {selectedNodeIds.length > 1 ? (
            <div className="selection-hint">
              已选中 {selectedNodeIds.length} 个节点，提问将聚焦于它们
            </div>
          ) : null}
          <div className="line-actions">
            <button type="button" onClick={draftNextLinePrompt}>
              下一条线
            </button>
            <button type="button" onClick={draftStructureTidyPrompt}>
              整理结构
            </button>
          </div>
          <div className="chat-input">
            <textarea
              ref={chatTextRef}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
              placeholder={
                isChatOnlyMode
                  ? "随便聊聊…"
                  : selectedNodeIds.length > 1
                    ? "对选中的节点提问…"
                    : "描述你想画的内容，如：用户登录流程..."
              }
            />
            <button onClick={sendChat} disabled={isSending} title={isSending ? "AI 正在回复" : "发送"}>
              {isSending ? <span className="send-spinner" /> : <Send size={16} />}
            </button>
          </div>
        </section>

        {pendingPatch ? (
          <section className="panel-block patch-card">
            <div className="panel-title">Patch preview</div>
            <p>{pendingPatch.summary}</p>
            <ul>
              {pendingPatch.operations.map((operation, index) => (
                <li key={`${operation.type}-${index}`}>{operation.type}</li>
              ))}
            </ul>
            <div className="patch-actions">
              <button className="primary-action compact" onClick={applyPendingPatch}>
                <Check size={15} />
                Apply
              </button>
              <button className="ghost compact" onClick={() => setPendingPatch(null)}>
                <X size={15} />
                Reject
              </button>
            </div>
          </section>
        ) : null}

        <section className="panel-block details-block">
          <div className="panel-title">Node detail</div>
          {selectedNode ? (
            <>
              <label>
                Title
                <input
                  value={selectedNode.data.title}
                  onChange={(event) => updateSelectedNode({ title: event.target.value })}
                />
              </label>
              <label>
                Body
                <textarea
                  value={selectedNode.data.body ?? ""}
                  onChange={(event) => updateSelectedNode({ body: event.target.value })}
                />
              </label>
              <label>
                Kind
                <select
                  value={selectedNode.data.kind ?? "concept"}
                  onChange={(event) =>
                    updateSelectedNode({
                      kind: event.target.value as GraphNodeData["kind"],
                    })
                  }
                >
                  <option value="concept">Concept</option>
                  <option value="process">Process</option>
                  <option value="system">System</option>
                  <option value="decision">Decision</option>
                  <option value="note">Note</option>
                </select>
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={enforceKindColor(selectedNode.data).color ?? "#f8fafc"}
                  disabled={selectedNode.data.kind === "process" || selectedNode.data.kind === "decision"}
                  onChange={(event) => updateSelectedNode({ color: event.target.value })}
                />
              </label>
            </>
          ) : (
            <p className="muted">Select a node to edit its text, kind, and color.</p>
          )}
        </section>
      </aside>

      {isModelManagerOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsModelManagerOpen(false)}
        >
          <section className="model-manager" onClick={(event) => event.stopPropagation()}>
            <header className="model-manager-header">
              <div>
                <h2>
                  {modelManagerMode === "providers"
                    ? "连接提供商"
                    : modelManagerMode === "custom"
                      ? "连接自定义接口"
                      : "管理模型"}
                </h2>
                <p>
                  {modelManagerMode === "models"
                    ? "自定义模型选择器中显示的模型。"
                    : "选择一个提供商，或使用 OpenAI-compatible 自定义接口。"}
                </p>
              </div>
              {modelManagerMode === "custom" ? (
                <button
                  className="connect-provider-button"
                  onClick={connectModel}
                  disabled={!draftProviderId.trim() || !draftBaseUrl.trim() || !draftModelId.trim()}
                >
                  <Plus size={15} />
                  连接当前模型
                </button>
              ) : modelManagerMode === "models" ? (
                <button
                  className="connect-provider-button"
                  onClick={() => setModelManagerMode("providers")}
                >
                  <Plus size={15} />
                  连接提供商
                </button>
              ) : (
                <button
                  className="connect-provider-button"
                  onClick={() => setModelManagerMode("models")}
                >
                  <SlidersHorizontal size={15} />
                  管理模型
                </button>
              )}
            </header>

            {modelManagerMode === "models" ? (
              <div className="model-manager-body single">
                <section className="model-list-panel">
                  <label className="model-search">
                    <Search size={17} />
                    <input
                      value={modelSearch}
                      onChange={(event) => setModelSearch(event.target.value)}
                      placeholder="搜索模型"
                    />
                  </label>

                  <div className="model-list">
                    {[...managedModelGroups.entries()].map(([providerName, models]) => (
                      <section className="model-group" key={providerName}>
                        <h3>{providerName}</h3>
                        {models.map((model) => {
                          const isEnabled = !disabledModelSet.has(model.id);
                          return (
                            <div
                              className={
                                model.id === effectiveSelectedModelId
                                  ? "model-row active"
                                  : "model-row"
                              }
                              key={model.id}
                              onClick={() => {
                                if (!isEnabled) toggleModelEnabled(model.id);
                                setSelectedModelId(model.id);
                              }}
                            >
                              <span>{model.provider === "custom" ? model.model : model.name}</span>
                              <small>{model.provider === "custom" ? model.customProvider?.name : model.model}</small>
                              {model.provider === "custom" ? (
                                <button
                                  className="model-row-delete"
                                  title="删除模型"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeModel(model.id);
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : (
                                <span />
                              )}
                              <button
                                className={isEnabled ? "model-toggle on" : "model-toggle"}
                                title={isEnabled ? "隐藏模型" : "显示模型"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleModelEnabled(model.id);
                                }}
                              >
                                <span />
                              </button>
                            </div>
                          );
                        })}
                      </section>
                    ))}
                    {!filteredManagedModels.length ? (
                      <p className="empty-models">没有找到匹配的模型。</p>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}

            {modelManagerMode === "providers" ? (
              <div className="provider-connect-body">
                <label className="model-search">
                  <Search size={17} />
                  <input placeholder="搜索提供商" />
                </label>
                <div className="provider-section-label">热门</div>
                <div className="provider-list">
                  {[
                    ["OpenCode Zen", "可靠的优化模型", "推荐"],
                    ["OpenCode Go", "适合所有人的低成本订阅", "推荐"],
                    ["Anthropic", "使用 Claude Pro/Max 或 API 密钥连接", ""],
                    ["GitHub Copilot", "使用 Copilot 或 API 密钥连接", ""],
                    ["OpenAI", "使用 ChatGPT Pro/Plus 或 API 密钥连接", ""],
                    ["Google", "使用 Gemini API 密钥连接", ""],
                    ["OpenRouter", "连接 OpenRouter API", ""],
                    ["Vercel AI Gateway", "连接 Vercel AI Gateway", ""],
                  ].map(([name, detail, badge]) => (
                    <button
                      className={name === "OpenCode Zen" ? "provider-row active" : "provider-row"}
                      key={name}
                      onClick={() => setModelManagerMode("custom")}
                    >
                      <span className="provider-logo">{name.slice(0, 1)}</span>
                      <strong>{name}</strong>
                      <small>{detail}</small>
                      {badge ? <span className="provider-badge">{badge}</span> : null}
                      <Plus size={15} />
                    </button>
                  ))}
                </div>
                <div className="provider-section-label">其他</div>
                <button className="provider-row subtle" onClick={() => setModelManagerMode("custom")}>
                  <span className="provider-logo">✦</span>
                  <strong>自定义</strong>
                  <small>OpenAI-compatible / NewAPI</small>
                  <span className="provider-badge">自定义</span>
                  <Plus size={15} />
                </button>
              </div>
            ) : null}

            {modelManagerMode === "custom" ? (
              <div className="model-manager-body">
              <section className="model-connect-panel">
                <div className="model-section-heading">
                  <strong>连接自定义接口</strong>
                  <small>支持 NewAPI / OpenAI-compatible</small>
                </div>
                <div className="custom-provider-form">
                  <label>
                    连接 JSON
                    <textarea
                      value={draftConnectorJson}
                      onChange={(event) => applyConnectorJson(event.target.value)}
                      placeholder='{"_type":"newapi_channel_conn","key":"sk-...","url":"https://api.example.com"}'
                    />
                  </label>
                  <div className="model-two-fields">
                    <label>
                      提供商 ID
                      <input
                        value={draftProviderId}
                        onChange={(event) => setDraftProviderId(event.target.value)}
                        placeholder="myprovider"
                      />
                    </label>
                    <label>
                      显示名称
                      <input
                        value={draftModelName}
                        onChange={(event) => setDraftModelName(event.target.value)}
                        placeholder="我的 AI 提供商"
                      />
                    </label>
                  </div>
                  <label>
                    基础 URL
                    <input
                      value={draftBaseUrl}
                      onChange={(event) => setDraftBaseUrl(event.target.value)}
                      placeholder="https://api.deepseek.com/v1"
                    />
                  </label>
                  <label>
                    API 密钥
                    <input
                      value={draftApiKey}
                      onChange={(event) => setDraftApiKey(event.target.value)}
                      placeholder="API 密钥"
                      type="password"
                    />
                  </label>
                  <label>
                    模型 ID
                    {draftModelOptions.length ? (
                      <select
                        value={draftModelId}
                        onChange={(event) => setDraftModelId(event.target.value)}
                      >
                        {draftModelOptions.map((model) => (
                          <option value={model} key={model}>
                            {customModelLookup.has(modelKey(draftProviderId, model))
                              ? `${model}（已连接）`
                              : model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={draftModelId}
                        onChange={(event) => setDraftModelId(event.target.value)}
                        placeholder="deepseek-chat"
                      />
                    )}
                  </label>
                  <div className="model-form-actions">
                    <button className="ghost compact" disabled={isLoadingModels} onClick={() => void loadModelsOnly({
                        baseUrl: draftBaseUrl.trim(),
                        apiKey: draftApiKey.trim(),
                        providerId: draftProviderId.trim().toLowerCase(),
                        providerName: draftModelName.trim() || "自定义接口",
                      })}>
                      {isLoadingModels ? "获取中" : "获取模型"}
                    </button>
                    {draftModelOptions.length > 1 ? (
                      <button className="ghost compact" onClick={connectAllLoadedModels}>
                        加入全部
                      </button>
                    ) : null}
                    {modelLoadError ? (
                      <span className={modelLoadError.startsWith("已获取") ? "success" : ""}>
                        {modelLoadError}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="model-list-panel">
                <div className="model-section-heading">
                  <strong>已连接模型</strong>
                  <small>连接后会自动显示在选择器里。</small>
                </div>
                <div className="model-list">
                  {userModels.filter((model) => model.model).map((model) => (
                    <div
                      className="model-row"
                      key={model.id}
                      onClick={() => setSelectedModelId(model.id)}
                    >
                      <span>{model.model}</span>
                      <small>{model.customProvider?.name || model.name}</small>
                      <button
                        className="model-row-delete"
                        title="删除模型"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeModel(model.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {!userModels.some((model) => model.model) ? (
                    <p className="empty-models">还没有自定义模型。</p>
                  ) : null}
                </div>
              </section>
            </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function nextUntitledTitle(documents: GraphDocument[]) {
  const used = new Set(documents.map((item) => item.title.trim()));
  if (!used.has("Untitled map")) return "Untitled map";

  let index = 2;
  while (used.has(`Untitled map ${index}`)) index += 1;
  return `Untitled map ${index}`;
}

function disambiguateDocumentTitles(documents: GraphDocument[]) {
  const seen = new Map<string, number>();
  return documents.map((document) => {
    const base = document.title.trim() || "Untitled map";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    if (count === 0) {
      return { ...document, title: base };
    }

    return {
      ...document,
      title: `${base} ${count + 1}`,
      updatedAt: Date.now(),
    };
  });
}

function readStoredUserModels() {
  const seed = SEED_CUSTOM_MODEL ? [SEED_CUSTOM_MODEL] : [];
  if (typeof window === "undefined") return seed;

  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    const parsed: ModelCatalogItem[] = stored ? JSON.parse(stored) : [];
    const customs = upsertCustomModels(
      [],
      parsed.filter((m) => m.provider === "custom"),
    );
    if (SEED_CUSTOM_MODEL) {
      const hasSeed = customs.some(
        (m) => m.customProvider?.baseUrl === SEED_CUSTOM_MODEL.customProvider?.baseUrl,
      );
      if (!hasSeed) customs.unshift(SEED_CUSTOM_MODEL);
    }
    return customs;
  } catch {
    return seed;
  }
}

function readDisabledModelIds() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(DISABLED_MODEL_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function readTrash(): GraphDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(TRASH_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as GraphDocument[];
    return parsed.filter((d) => Date.now() - d.updatedAt < 30 * 86400000);
  } catch {
    return [];
  }
}

function createOfficialDeepSeekModel(model: string): ModelCatalogItem {
  return {
    id: `official-${model}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    name: humanizeModelName(model),
    provider: "deepseek",
    model,
  };
}

function createCustomModelId(providerId: string, model: string) {
  return `custom-${modelKey(providerId, model)}`;
}

function modelKey(providerId: string, model: string) {
  return `${safeKeyPart(providerId)}-${safeKeyPart(model)}`;
}

function safeKeyPart(value: string) {
  return encodeURIComponent(value.trim().toLowerCase())
    .replace(/%/g, "_")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function upsertCustomModels(
  currentModels: ModelCatalogItem[],
  nextModels: ModelCatalogItem[],
) {
  const byKey = new Map<string, ModelCatalogItem>();
  const orderedKeys: string[] = [];

  for (const model of currentModels) {
    const key =
      model.provider === "custom" && model.customProvider && model.model
        ? modelKey(model.customProvider.id, model.model)
        : model.id;
    if (!byKey.has(key)) orderedKeys.push(key);
    byKey.set(key, model);
  }

  for (const model of nextModels) {
    const key =
      model.provider === "custom" && model.customProvider && model.model
        ? modelKey(model.customProvider.id, model.model)
        : model.id;
    if (!byKey.has(key)) orderedKeys.push(key);
    byKey.set(key, model);
  }

  return orderedKeys.map((key) => byKey.get(key)!);
}

function orientEdgesByNodePosition(nodes: GraphNode[], edges: GraphEdge[]) {
  return edges.map((edge) => orientConnectionByNodePosition(nodes, edge));
}

function orientConnectionByNodePosition<T extends Connection | GraphEdge>(
  nodes: GraphNode[],
  connection: T,
): T {
  const sourceId = connection.source;
  const targetId = connection.target;
  if (!sourceId || !targetId) return connection;

  const sourceNode = nodes.find((node) => node.id === sourceId);
  const targetNode = nodes.find((node) => node.id === targetId);
  if (!sourceNode || !targetNode) return connection;

  const sourceCenter = nodeCenterX(sourceNode);
  const targetCenter = nodeCenterX(targetNode);
  const sourceSide = sourceCenter <= targetCenter ? "right" : "left";
  const targetSide = sourceSide === "right" ? "left" : "right";

  return {
    ...connection,
    sourceHandle: `source-${sourceSide}`,
    targetHandle: `target-${targetSide}`,
  };
}

function nodeCenterX(node: GraphNode) {
  return node.position.x + (node.measured?.width ?? 220) / 2;
}

function isLikelyTrackpadPan(event: React.WheelEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (absX === 0 && absY === 0) return false;

  const hasFineDelta =
    !Number.isInteger(event.deltaX) ||
    !Number.isInteger(event.deltaY) ||
    (absY > 0 && absY < 60) ||
    (absX > 0 && absX < 60);

  const looksLikeMouseWheel = absX === 0 && absY >= 80 && Number.isInteger(event.deltaY);
  return hasFineDelta && !looksLikeMouseWheel;
}

function humanizeModelName(model: string) {
  return model
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "deepseek") return "DeepSeek";
      if (part.toLowerCase() === "v4") return "V4";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function relativeTime(ts: number) {
  if (!ts) return "未知时间";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return "刚刚";
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}天前`;
  if (day < 30) return `${Math.floor(day / 7)}周前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

function messageRunStatus(
  message: ChatMessage,
  messages: ChatMessage[],
  index: number,
) {
  const previousUserMessage = [...messages.slice(0, index)]
    .reverse()
    .find((item) => item.role === "user");
  if (!previousUserMessage) return "已处理";
  return `已处理 ${formatDuration(message.createdAt - previousUserMessage.createdAt)}`;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function nodeSummary(node: GraphNode) {
  const text = (node.data.body ?? "").replace(/\s+/g, " ").trim();
  return text.length > 44 ? `${text.slice(0, 44)}...` : text;
}

function getDocumentStats(document: GraphDocument | null) {
  const nodes = document?.nodes ?? [];
  return {
    total: nodes.length,
    actions: nodes.filter((node) => node.data.kind === "process").length,
    decisions: nodes.filter((node) => node.data.kind === "decision").length,
  };
}

function projectStatsLine(document: GraphDocument) {
  const stats = getDocumentStats(document);
  return `${stats.total} nodes · 行动 ${stats.actions} · 决策 ${stats.decisions}`;
}

function reasoningLabel(value: ReasoningEffort) {
  const labels: Record<ReasoningEffort, string> = {
    auto: "Auto",
    low: "低",
    medium: "中",
    high: "高",
    max: "Max",
  };
  return labels[value];
}

function ActionDecisionSection({
  title,
  count,
  nodes,
  emptyText,
  actionText,
  selectedNodeId,
  onSelectNode,
  onDraft,
}: {
  title: string;
  count: number;
  nodes: GraphNode[];
  emptyText: string;
  actionText: string;
  selectedNodeId: string | null;
  onSelectNode: (node: GraphNode) => void;
  onDraft: () => void;
}) {
  return (
    <section className="decision-action-section">
      <div className="decision-action-heading">
        <span>{title}</span>
        <strong>{count}</strong>
      </div>
      <div className="decision-action-list">
        {nodes.length ? (
          nodes.map((node) => (
            <button
              className={selectedNodeId === node.id ? "active" : ""}
              key={node.id}
              onClick={() => onSelectNode(node)}
            >
              <span>{node.data.title}</span>
              {node.data.body ? <small>{nodeSummary(node)}</small> : null}
            </button>
          ))
        ) : (
          <div className="decision-action-empty">
            <p>{emptyText}</p>
            <button onClick={onDraft}>{actionText}</button>
          </div>
        )}
      </div>
    </section>
  );
}

function GraphCard({ data, selected }: NodeProps<GraphNode>) {
  return (
    <div
      className={[
        "graph-card",
        data.kind === "process" ? "action-node" : "",
        data.kind === "decision" ? "decision-node" : "",
        selected ? "selected" : "",
      ].filter(Boolean).join(" ")}
      style={{ background: enforceKindColor(data).color ?? "#f8fafc" }}
    >
      <Handle
        id="target-left"
        className="card-handle card-handle-left card-handle-target"
        type="target"
        position={Position.Left}
      />
      <Handle
        id="source-left"
        className="card-handle card-handle-left card-handle-source"
        type="source"
        position={Position.Left}
      />
      <div className="node-kind">{data.kind ?? "concept"}</div>
      <strong>{data.title}</strong>
      {data.body ? <p>{data.body}</p> : null}
      <Handle
        id="target-right"
        className="card-handle card-handle-right card-handle-target"
        type="target"
        position={Position.Right}
      />
      <Handle
        id="source-right"
        className="card-handle card-handle-right card-handle-source"
        type="source"
        position={Position.Right}
      />
    </div>
  );
}
