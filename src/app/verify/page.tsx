import { Suspense } from "react";
import { VerifyPanel } from "@/components/verify-panel";
import { allBoards, ensureSeedBoard } from "@/lib/service";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Verify seals" };

export default async function VerifyPage() {
  const sessionId = await getSessionId();
  await ensureSeedBoard(sessionId);
  const boards = await allBoards(sessionId);

  return (
    <Suspense fallback={null}>
      <VerifyPanel boards={boards.map((board) => ({ id: board.id, subjectName: board.subjectName }))} />
    </Suspense>
  );
}