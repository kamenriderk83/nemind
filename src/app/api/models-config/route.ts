import { NextResponse } from "next/server";
import { readServerModelConfigs, writeServerModelConfigs } from "@/lib/server-models";

export async function GET() {
  const models = await readServerModelConfigs();
  return NextResponse.json({ models });
}

export async function POST(request: Request) {
  const body = await request.json();
  const models = Array.isArray(body.models) ? body.models : [];
  await writeServerModelConfigs(models);
  return NextResponse.json({ ok: true });
}
