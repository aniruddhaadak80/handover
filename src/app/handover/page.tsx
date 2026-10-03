import Link from "next/link";
import { Suspense } from "react";
import { allBoards, ensureSeedBoard } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { HandoverScrubber } from "@/components/handover-scrubber";

export const dynamic = "force-dynamic";

export const metadata = { title: "Handover" };

export default async function HandoverPage() {
  const sessionId = await getSessionId();
  await ensureSeedBoard(sessionId);
  const boards = await allBoards(sessionId);
  const now = new Date();

  return (
    <Suspense fallback={<div className="px-4 py-16 text-center text-sm text-chalk-dim">Loading the shift rail...</div>}>
      <HandoverScrubber
        boards={boards.map((board) => ({ id: board.id, subjectName: board.subjectName, openDoses: 0 }))}
        initialNow={now.toISOString()}
      />
      <div className="mx-auto max-w-6xl px-4 pb-4">
        <Link href="/boards" className="text-xs text-chalk-faint underline underline-offset-2 hover:text-lamp-300">
          Back to all care boards
        </Link>
      </div>
    </Suspense>
  );
}