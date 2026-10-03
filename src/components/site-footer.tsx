import Link from "next/link";
import { navigation, siteConfig } from "@/lib/config";
import { GitHubLink } from "./github-link";

export function SiteFooter() {
  const year = 2026;

  return (
    <footer className="mt-20 border-t border-ward-700 bg-ward-950">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-xl text-chalk">Handover</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-chalk-dim">{siteConfig.description}</p>
          <GitHubLink href={siteConfig.repoUrl} label="View source on GitHub" variant="footer" className="mt-4" />
        </div>

        <nav aria-label="Footer">
          <p className="stamp stamp--caution">Product</p>
          <ul className="mt-3 space-y-2">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-chalk-dim transition-colors hover:text-lamp-300"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Project">
          <p className="stamp stamp--caution">Project</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link href="/agent" className="text-sm text-chalk-dim hover:text-lamp-300">
                MCP agent tools
              </Link>
            </li>
            <li>
              <Link href="/verify" className="text-sm text-chalk-dim hover:text-lamp-300">
                Verify the seal chain
              </Link>
            </li>
            <li>
              <a
                href="/mcp.json"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-chalk-dim hover:text-lamp-300"
              >
                Agent manifest
              </a>
            </li>
            <li>
              <a
                href={`${siteConfig.repoUrl}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-chalk-dim hover:text-lamp-300"
              >
                Report an issue
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-ward-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-xs text-chalk-faint md:flex-row md:items-center md:justify-between">
          <p>MIT licensed. Built for one specific person, then opened up for everyone.</p>
          <p>
            {year} &middot; Label data from{" "}
            <a
              href="https://open.fda.gov/apis/drug/label/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-ward-600 underline-offset-2 hover:text-lamp-300"
            >
              openFDA
            </a>{" "}
            and{" "}
            <a
              href="https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-ward-600 underline-offset-2 hover:text-lamp-300"
            >
              RxNorm
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}