import { notFound } from "next/navigation";
import { RegimenPanel } from "@/components/regimen-panel";
import { listEntries } from "@/lib/repo/store";
import { boardSnapshot } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { StoreError } from "@/lib/repo/store";

export const dynamic = "force-dynamic";

export const metadata = { title: "Medicines and labels" };

export default async function RegimenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = await getSessionId();

  let board;
  try {
    ({ board } = await boardSnapshot(sessionId, id, { skipDrugs: true }));
  } catch (error) {
    if (error instanceof StoreError && error.status === 404) notFound();
    throw error;
  }

  const entries = await listEntries(id);
  const rows = entries
    .filter((entry) => entry.medication)
    .map((entry) => ({
      medication: entry.medication as string,
      strength: entry.strength,
      instructions: entry.instructions,
      status: entry.status,
      scheduledFor: entry.scheduledFor,
    }));

  return <RegimenPanel boardId={id} subjectName={board.subjectName} rows={rows} />;
}