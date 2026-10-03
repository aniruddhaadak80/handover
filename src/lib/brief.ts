import type { HandoverBrief, CareEntry } from "./types";

function clock(value: string | null, fallback: string): string {
  const source = value ?? fallback;
  const parsed = Date.parse(source);
  if (Number.isNaN(parsed)) return "unclear";
  return new Date(parsed).toISOString().slice(11, 16);
}

function line(entry: CareEntry): string {
  const when = entry.occurredAt ?? entry.scheduledFor ?? entry.createdAt;
  const parts = [
    `- \`${clock(when, entry.createdAt)}\` **${entry.title}**`,
    `(${entry.status})`,
    entry.assignedTo ? `- owner: ${entry.assignedTo}` : "- **owner: nobody**",
  ];
  if (entry.doseAmount) parts.push(`- dose: ${entry.doseAmount}`);
  if (entry.route) parts.push(`- route: ${entry.route}`);
  if (entry.instructions) parts.push(`- instructions: ${entry.instructions}`);
  parts.push(`- note: ${entry.detail}`);
  return parts.join(" ");
}

/** The downloadable artifact. Plain text on purpose: it survives every mail client. */
export function renderBriefMarkdown(brief: HandoverBrief): string {
  const sources = brief.sources.length
    ? brief.sources.map((source) => `- ${source.name} - ${source.status}, fetched ${source.fetchedAt} - ${source.url}${source.note ? ` (${source.note})` : ""}`)
    : ["- No external source was consulted for this brief."];

  return `# Handover brief: ${brief.subjectName}

- Handover moment: ${brief.asOf}
- Generated: ${brief.generatedAt}
- Handover readiness: **${brief.score}/100** - **${brief.verdict.toUpperCase()}**
- Engine: ${brief.analysis.engineVersion}
- Decision: ${brief.decision}
- Seal: \`${brief.seal ?? "no events sealed yet"}\`

## Say out loud before you go

${brief.blockingIssues.length > 0 ? brief.blockingIssues.map((issue) => `- ${issue}`).join("\n") : "- Nothing blocking. Nothing stale."}

## Carried by the outgoing person (${brief.outgoing.length})

${brief.outgoing.length > 0 ? brief.outgoing.map(line).join("\n") : "_Nothing recorded before the handover moment._"}

## Inherited by the next person (${brief.incoming.length})

${brief.incoming.length > 0 ? brief.incoming.map(line).join("\n") : "_Nothing scheduled after the handover moment._"}

## Doses still due

${brief.dueNext.length > 0 ? brief.dueNext.map(line).join("\n") : "_No dose is outstanding._"}

## Factor breakdown

| Factor | Weight | Value | Status |
| --- | --- | --- | --- |
${brief.analysis.factors.map((factor) => `| ${factor.label} | ${factor.weight} | ${factor.value} | ${factor.status} |`).join("\n")}

## Sources

${sources.join("\n")}

---

${brief.disclaimer}
`;
}