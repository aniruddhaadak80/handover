import { AgentConsole } from "@/components/agent-console";
import { allBoards, ensureSeedBoard } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { listEntries } from "@/lib/repo/store";

export const dynamic = "force-dynamic";

export const metadata = { title: "Agent console" };

export default async function AgentPage() {
  const sessionId = await getSessionId();
  await ensureSeedBoard(sessionId);
  const boards = await allBoards(sessionId);
  const withCounts = await Promise.all(
    boards.map(async (board) => ({ id: board.id, subjectName: board.subjectName, entryCount: (await listEntries(board.id)).length })),
  );

  return <AgentConsole boards={withCounts} />;
}