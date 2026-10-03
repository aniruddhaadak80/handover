import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BoardPanel } from "@/components/board-panel";
import { boardSnapshot } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { StoreError } from "@/lib/repo/store";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = await getSessionId();

  let initial;
  try {
    initial = await boardSnapshot(sessionId, id);
  } catch (error) {
    if (error instanceof StoreError && error.status === 404) notFound();
    throw error;
  }

  return (
    <Suspense fallback={null}>
      <BoardPanel boardId={id} initial={initial} />
    </Suspense>
  );
}