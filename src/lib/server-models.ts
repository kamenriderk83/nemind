import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = process.env.NEMIND_DATA_DIR || join(process.cwd(), ".nemind-data");
const MODELS_FILE = join(DATA_DIR, "models.json");

export type ServerModelConfig = {
  id: string;
  name: string;
  provider: string;
  model: string;
  customProvider?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
  };
};

export async function readServerModelConfigs(): Promise<ServerModelConfig[]> {
  if (isServerStorageDisabled()) return [];
  try {
    const content = await readFile(MODELS_FILE, "utf8");
    const parsed = JSON.parse(content) as ServerModelConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeServerModelConfigs(models: ServerModelConfig[]) {
  if (isServerStorageDisabled()) return;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MODELS_FILE, JSON.stringify(models, null, 2), "utf8");
}

function isServerStorageDisabled() {
  return process.env.NEMIND_DISABLE_SERVER_STORAGE === "1" || process.env.VERCEL === "1";
}
