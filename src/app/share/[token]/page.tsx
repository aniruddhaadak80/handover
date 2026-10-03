import { notFound } from "next/navigation";
import { VerdictStamp } from "@/components/readiness-meter";
import { renderBriefMarkdown } from "@/lib/brief";
import { publicBrief } from "@/lib/service";
import { siteConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Shared handover brief", robots: { index: false } };

/**
 * A stable, token-scoped share route. Read-only, no cookie required, and it
 * never exposes the board id or any other board.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const handoverAt = new Date().toISOString();

  let brief;
  try {
    brief = await publicBrief(token, handoverAt);
  } catch {
    notFound();
  }

  const markdown = renderBriefMarkdown(brief);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="stamp stamp--caution">Read-only share link</p>
      <h1 className="mt-3 font-display text-3xl tracking-tight text-chalk">{brief.subjectName}</h1>
      <p className="mt-2 font-mono text-xs text-chalk-faint">
        handover at {brief.asOf} &middot; generated {brief.generatedAt}
      </p>

      <div className="mt-5 flex items-center gap-4">
        <p className="font-display text-5xl tabular-nums text-chalk">{brief.score}</p>
        <VerdictStamp verdict={brief.verdict} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{brief.decision}</p>

      <pre className="mt-6 max-h-[32rem] overflow-auto border border-ward-700 bg-ward-950 p-4 font-mono text-xs leading-relaxed text-chalk-dim">
        {markdown}
      </pre>

      <p className="mt-4 text-xs leading-relaxed text-chalk-faint">{brief.disclaimer}</p>
      <a
        href={siteConfig.repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block text-xs text-chalk-faint underline underline-offset-2 hover:text-lamp-300"
      >
        This is an open-source project
      </a>
    </div>
  );
}