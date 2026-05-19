"use client";

import { openDB } from "idb";
import type { GraphDocument } from "@/lib/types";

const DB_NAME = "nemind";
const STORE_NAME = "documents";
const LOCAL_KEY = "nemind.documents";

async function getDb() {
  return withTimeout(
    openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      },
    }),
    1200,
  );
}

export async function saveDocument(
  document: GraphDocument,
  options: { touch?: boolean } = { touch: true },
) {
  const next = options.touch === false ? document : { ...document, updatedAt: Date.now() };
  saveLocal(next);
  await saveServer(next).catch(() => undefined);
  await getDb()
    .then((db) => withTimeout(db.put(STORE_NAME, next), 1200))
    .catch(() => undefined);
}

export async function loadDocuments() {
  const localDocuments = loadLocal();
  const serverDocuments = await loadServer().catch(() => []);
  const documents = serverDocuments.length
    ? mergeDocuments(serverDocuments, localDocuments)
    : localDocuments;

  return documents.sort(
    (a: GraphDocument, b: GraphDocument) => b.updatedAt - a.updatedAt,
  ) as GraphDocument[];
}

export async function deleteDocument(id: string) {
  const remaining = loadLocal().filter((document) => document.id !== id);
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(remaining));
  await deleteServer(id).catch(() => undefined);
  await getDb()
    .then((db) => withTimeout(db.delete(STORE_NAME, id), 1200))
    .catch(() => undefined);
}

async function loadServer() {
  const response = await fetch("/api/documents", { cache: "no-store" });
  if (!response.ok) return [];
  const result = (await response.json()) as { documents?: GraphDocument[] };
  const documents = result.documents ?? [];
  documents.forEach(saveLocal);
  return documents;
}

async function saveServer(document: GraphDocument) {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) throw new Error("Server save failed");
}

async function deleteServer(id: string) {
  const response = await fetch("/api/documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error("Server delete failed");
}

function saveLocal(document: GraphDocument) {
  if (!hasLocalStorage()) return;
  const documents = [
    document,
    ...loadLocal().filter((item) => item.id !== document.id),
  ];
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(documents));
}

function loadLocal(): GraphDocument[] {
  if (!hasLocalStorage()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function hasLocalStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function mergeDocuments(...groups: GraphDocument[][]) {
  const byId = new Map<string, GraphDocument>();
  groups.flat().forEach((document) => {
    const existing = byId.get(document.id);
    if (!existing || document.updatedAt > existing.updatedAt) {
      byId.set(document.id, document);
    }
  });
  return Array.from(byId.values());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("IndexedDB timed out")), timeoutMs),
    ),
  ]);
}
