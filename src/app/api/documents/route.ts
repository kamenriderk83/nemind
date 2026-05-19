import { NextResponse } from "next/server";
import { z } from "zod";
import { readServerDocuments, writeServerDocuments } from "@/lib/server-documents";
import type { GraphDocument } from "@/lib/types";

const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.literal(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  messages: z.array(z.unknown()),
});

const deleteSchema = z.object({
  id: z.string(),
});

export async function GET() {
  const documents = await readServerDocuments();
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = documentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const documents = await readServerDocuments();
  const nextDocument = { ...parsed.data, updatedAt: Date.now() } as GraphDocument;
  await writeServerDocuments([
    nextDocument,
    ...documents.filter((document) => document.id !== nextDocument.id),
  ]);

  return NextResponse.json({ document: nextDocument });
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const documents = await readServerDocuments();
  await writeServerDocuments(
    documents.filter((document) => document.id !== parsed.data.id),
  );

  return NextResponse.json({ ok: true });
}
