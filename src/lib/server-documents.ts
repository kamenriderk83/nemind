import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GraphDocument } from "@/lib/types";

const DATA_DIR = process.env.NEMIND_DATA_DIR || join(process.cwd(), ".nemind-data");
const DOCUMENTS_FILE = join(DATA_DIR, "documents.json");

export async function readServerDocuments() {
  if (isServerStorageDisabled()) return [];
  try {
    const content = await readFile(DOCUMENTS_FILE, "utf8");
    const parsed = JSON.parse(content) as GraphDocument[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => b.updatedAt - a.updatedAt)
      : [];
  } catch {
    return [];
  }
}

export async function writeServerDocuments(documents: GraphDocument[]) {
  if (isServerStorageDisabled()) return;
  await mkdir(DATA_DIR, { recursive: true });
  const sorted = documents.sort((a, b) => b.updatedAt - a.updatedAt);
  const json = JSON.stringify(sorted, null, 2);
  await writeFile(DOCUMENTS_FILE, json, "utf8");
}

function isServerStorageDisabled() {
  return process.env.NEMIND_DISABLE_SERVER_STORAGE === "1" || process.env.VERCEL === "1";
}
