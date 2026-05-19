import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEEPSEEK_MODELS,
  listOpenAiCompatibleModels,
} from "@/lib/ai/openai-compatible";

const modelListRequestSchema = z.object({
  provider: z.enum(["deepseek", "custom"]),
  customProvider: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      baseUrl: z.string().min(1),
      apiKey: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = modelListRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { models: [], error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.provider === "deepseek") {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return NextResponse.json({ models: DEEPSEEK_MODELS });

      const models = await listOpenAiCompatibleModels({
        apiKey,
        baseUrl: "https://api.deepseek.com/v1",
      });
      return NextResponse.json({
        models: models.length ? models : DEEPSEEK_MODELS,
      });
    }

    const config = parsed.data.customProvider;
    if (!config) {
      return NextResponse.json(
        { models: [], error: "Missing custom provider config." },
        { status: 400 },
      );
    }

    const models = await listOpenAiCompatibleModels({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      {
        models: [],
        error: error instanceof Error ? error.message : "Failed to load models.",
      },
      { status: 502 },
    );
  }
}
