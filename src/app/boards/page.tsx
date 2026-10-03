import Link from "next/link";
import { VerdictStamp } from "@/components/readiness-meter";
import { StartBoard } from "@/components/start-board";
import { allBoards, boardSnapshot, ensureSeedBoard } from "@/lib/service";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Care boards" };

export default async function BoardsPage() {
  const sessionId = await getSessionId();
  await ensureSeedBoard(sessionId);
  const boards = await allBoards(sessionId);
  const rows = await Promise.all(
    boards.map(async (board) => {
      const snapshot = await boardSnapshot(sessionId, board.id, { skipDrugs: true });
      return {
        board,
        entryCount: snapshot.entries.length,
        openDoses: snapshot.analysis.openDoses,
        score: snapshot.analysis.score,
        verdict: snapshot.analysis.verdict,
        decision: snapshot.analysis.decision,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="stamp stamp--caution">Ward desk</p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-chalk sm:text-4xl">Care boards</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-chalk-dim">
            One board per person. Boards belong to this browser session only; nothing is shared until you create a
            share link.
          </p>
        </div>
        <StartBoard withExampleEntries label="New board with the worked example" />
      </div>

      {rows.length === 0 ? (
        <div className="card mt-8 p-10 text-center">
          <p className="font-display text-2xl text-chalk">Nothing on the desk</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-chalk-dim">
            Create the first board above. It is written to the database immediately, so you can close the tab and
            come back to it.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {rows.map(({ board, entryCount, openDoses, score, verdict, decision }) => (
            <li key={board.id} className="pin p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-xl leading-snug text-chalk">{board.subjectName}</h2>
                  <p className="mt-1 font-mono text-xs text-chalk-faint">
                    {entryCount} entries &middot; {openDoses} outstanding &middot;{" "}
                    {board.caregivers.join(", ") || "no caregivers named"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-3xl tabular-nums text-chalk">{score}</p>
                  <VerdictStamp verdict={verdict} />
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{decision}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/boards/${board.id}`}
                  className="border border-lamp-400 bg-lamp-400 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300"
                >
                  Open the board
                </Link>
                <Link
                  href={`/handover?board=${board.id}`}
                  className="border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 hover:text-lamp-300"
                >
                  Run a handover
                </Link>
                <Link
                  href={`/boards/${board.id}/regimen`}
                  className="border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 hover:text-lamp-300"
                >
                  Medicines
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}