"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { navigation, siteConfig } from "@/lib/config";
import { GitHubLink, WordmarkLink } from "./github-link";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-ward-700 bg-ward-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <WordmarkLink />

        <nav aria-label="Primary" className="hidden items-center gap-5 md:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`font-mono text-xs uppercase tracking-[0.14em] transition-colors ${
                isActive(item.href) ? "text-lamp-300" : "text-chalk-dim hover:text-chalk"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <GitHubLink href={siteConfig.repoUrl} label="Star on GitHub" variant="nav" />
        </nav>

        <button
          type="button"
          className="inline-flex items-center gap-2 border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          Menu
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-ward-700 bg-ward-900 md:hidden">
          <nav aria-label="Primary mobile" className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`border-l-2 py-2 pl-3 font-mono text-sm uppercase tracking-[0.14em] ${
                  isActive(item.href)
                    ? "border-lamp-400 text-lamp-300"
                    : "border-transparent text-chalk-dim"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <GitHubLink
              href={siteConfig.repoUrl}
              label="Star on GitHub"
              variant="nav"
              className="border-l-2 border-transparent py-2 pl-3"
            />
          </nav>
        </div>
      ) : null}
    </header>
  );
}