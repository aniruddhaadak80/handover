import Link from "next/link";
import { GitHubLink, GitHubMark } from "@/components/github-link";
import { StartBoard } from "@/components/start-board";
import { ENGINE_VERSION } from "@/lib/engine/readiness";
import { siteConfig } from "@/lib/config";

export default function LandingPage() {
  return (
    <div className="lamp-glow">
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-14 md:pt-20">
        <p className="stamp stamp--caution">03:00 &middot; the shift changed two hours ago</p>
        <h1 className="mt-6 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight text-chalk sm:text-6xl">
          The handover board for one person you love.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-chalk-dim sm:text-lg">
          When someone comes home from hospital, the hard part is not the medication. It is that four people
          each believe they know the schedule. Handover is one shared board for those four people: log the dose,
          let a deterministic engine tell you what the next person is about to get wrong, then seal a brief they
          can act on at three in the morning without asking you anything.
        </p>

        <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-start">
          <StartBoard withExampleEntries label="Open the worked example" variant="primary" />
          <StartBoard withExampleEntries={false} label="Start an empty board" variant="quiet" />
        </div>

        <p className="mt-4 max-w-xl text-xs leading-relaxed text-chalk-faint">
          Both actions write a real board to a real database. No account, no key, nothing stored in your browser
          only.
        </p>
      </section>

      <section className="border-y border-ward-700 bg-ward-900/60">
        <div className="mx-auto grid max-w-6xl gap-px bg-ward-700 md:grid-cols-3">
          <article className="bg-ward-900 p-6">
            <p className="stamp stamp--hold">Catches</p>
            <h2 className="mt-4 font-display text-xl text-chalk">Two entries, one ingredient</h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
              A brand name and a generic name for the same drug, one dose past the point where anyone was paying
              attention. The engine normalizes both and says so, with the two entries quoted back at you.
            </p>
          </article>
          <article className="bg-ward-900 p-6">
            <p className="stamp stamp--caution">Checks</p>
            <h2 className="mt-4 font-display text-xl text-chalk">A dose at 7:00 needing food, one at 7:30 needing an empty stomach</h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
              Not a vibe. A weighted, itemized, versioned score with every penalty traceable to a row on your
              board or a section of a public label.
            </p>
          </article>
          <article className="bg-ward-900 p-6">
            <p className="stamp stamp--ready">Seals</p>
            <h2 className="mt-4 font-display text-xl text-chalk">What you decided at 3am stays decided</h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
              Every log, decision and handover appends to a SHA-384 hash chain. Replay it any time; if a row was
              rewritten, the first broken link tells you exactly where.
            </p>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="font-display text-3xl tracking-tight text-chalk">Built for a person, not a persona</h2>
            <p className="mt-4 text-sm leading-relaxed text-chalk-dim">
              This started as a board for one specific person after a specific hospital discharge, for the friend
              who was doing all the remembering. It stayed general enough that anyone can start one tonight, and
              narrow enough that it only does the one job properly.
            </p>
            <dl className="mt-6 space-y-4">
              <div>
                <dt className="stamp stamp--caution">Log once</dt>
                <dd className="mt-2 text-sm text-chalk-dim">
                  A dose, a blood pressure, a note from physio, a task for tomorrow. Name the owner, or the check
                  will nag you about it.
                </dd>
              </div>
              <div>
                <dt className="stamp stamp--caution">Ask before you hand over</dt>
                <dd className="mt-2 text-sm text-chalk-dim">
                  Drag the handover moment along the shift rail. Entries physically move from the outgoing
                  person to the next one, and the readiness score recomputes for that exact moment.
                </dd>
              </div>
              <div>
                <dt className="stamp stamp--caution">Take the brief with you</dt>
                <dd className="mt-2 text-sm text-chalk-dim">
                  Download a Markdown or printable brief with the dose timeline, the open risks, the sources it
                  used, and the seal that proves nobody edited it afterwards.
                </dd>
              </div>
            </dl>
          </div>

          <div className="card p-6">
            <p className="stamp stamp--ready">No closed model in the loop</p>
            <p className="mt-4 text-sm leading-relaxed text-chalk-dim">
              The scoring engine is deterministic code you can read in one sitting. The discharge-note parser is
              deterministic too, so a draft regimen is reproducible instead of a hallucination. Live label data
              comes from two public APIs that need no key: openFDA and NIH RxNorm.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-chalk-dim">
              The optional on-device reader runs an open-weights model inside your browser tab, so a parent&apos;s
              discharge summary never has to travel to a server we control.
            </p>
            <p className="mt-5 border-t border-ward-700 pt-4 font-mono text-xs text-chalk-faint">
              engine {ENGINE_VERSION}
            </p>
            <div className="mt-4">
              <GitHubLink href={siteConfig.repoUrl} label="Star on GitHub" variant="cta" />
            </div>
            <Link
              href="/agent"
              className="mt-3 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk-dim hover:text-lamp-300"
            >
              <GitHubMark className="h-3.5 w-3.5 opacity-0" aria-hidden="true" />
              Or call the same tools over MCP
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-ward-700 bg-ward-900/60">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <p className="stamp stamp--hold">Read this first</p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-chalk-dim">
            Handover surfaces record-keeping gaps and public label sections. It is not a clinician, it does not
            diagnose, and it never tells anyone to start, stop or change a dose. Anything it flags is a reason to
            ask the prescriber or the pharmacist, not a conclusion. If someone is in danger, call emergency
            services instead of opening this app.
          </p>
        </div>
      </section>
    </div>
  );
}