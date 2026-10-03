import type { HandoverAnalysis } from "@/lib/types";

const BAR: Record<string, string> = {
  clear: "bg-mint",
  watch: "bg-lamp-400",
  blocking: "bg-alert",
};

export function VerdictStamp({ verdict }: { verdict: HandoverAnalysis["verdict"] }) {
  return <span className={`stamp stamp--${verdict}`}>{verdict}</span>;
}

export function ReadinessMeter({ analysis }: { analysis: HandoverAnalysis }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="stamp stamp--caution">Handover readiness</p>
          <p className="mt-3 font-display text-5xl leading-none text-chalk tabular-nums">{analysis.score}</p>
          <p className="mt-1 text-xs text-chalk-faint">out of 100 &middot; engine {analysis.engineVersion}</p>
        </div>
        <VerdictStamp verdict={analysis.verdict} />
      </div>

      <div className="meter mt-4 h-2" role="img" aria-label={`Readiness score ${analysis.score} of 100, verdict ${analysis.verdict}`}>
        <span className={`${BAR[analysis.verdict === "ready" ? "clear" : analysis.verdict === "caution" ? "watch" : "blocking"]}`} style={{ width: `${analysis.score}%` }} />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-chalk-dim">{analysis.decision}</p>

      <ul className="mt-5 space-y-3">
        {analysis.factors.map((factor) => (
          <li key={factor.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-chalk">{factor.label}</span>
              <span className="font-mono text-xs tabular-nums text-chalk-dim">
                {factor.value} &middot; w{factor.weight}
              </span>
            </div>
            <div className="meter mt-1 h-1.5">
              <span className={BAR[factor.status]} style={{ width: `${factor.value}%` }} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-chalk-faint">{factor.summary}</p>
            {factor.evidence.filter((item) => item.penalty > 0).length > 0 ? (
              <ul className="mt-2 space-y-1.5 border-l border-ward-700 pl-3">
                {factor.evidence
                  .filter((item) => item.penalty > 0)
                  .slice(0, 4)
                  .map((item, index) => (
                    <li key={`${factor.key}-${index}`} className="text-xs leading-relaxed text-chalk-dim">
                      <span className={item.penalty >= 20 ? "text-alert" : "text-lamp-300"}>-{item.penalty}</span>{" "}
                      {item.detail}
                      {item.sourceId ? (
                        <span className="mt-0.5 block text-[11px] text-chalk-faint">
                          source: {item.sourceId} ({item.sourceStatus})
                        </span>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}