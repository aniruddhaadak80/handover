import Link from "next/link";

/** Official GitHub mark, inlined so no icon library guess is involved. */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      focusable="false"
    >
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.8 5.65-5.48 5.95.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

export type GitHubLinkProps = {
  href: string;
  label: string;
  variant?: "nav" | "footer" | "cta";
  className?: string;
};

const base =
  "inline-flex items-center gap-2 font-mono uppercase tracking-[0.14em] text-xs transition-colors";

const variants: Record<NonNullable<GitHubLinkProps["variant"]>, string> = {
  nav: "text-chalk-dim hover:text-lamp-300",
  footer: "text-chalk-dim hover:text-lamp-300",
  cta: "border border-lamp-400 text-lamp-300 px-4 py-2 hover:bg-lamp-400 hover:text-ward-950",
};

/** The repository is a product surface: one component, used by nav, footer and CTA. */
export function GitHubLink({ href, label, variant = "nav", className = "" }: GitHubLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens the public repository in a new tab)`}
      className={`${base} ${variants[variant]} ${className}`}
    >
      <GitHubMark className="h-4 w-4" />
      <span>{label}</span>
    </a>
  );
}

export function WordmarkLink({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group flex items-baseline gap-2" aria-label="Handover home">
      <span className="font-display text-2xl leading-none tracking-tight text-chalk group-hover:text-lamp-300">
        Handover
      </span>
      <span className="stamp stamp--caution hidden sm:inline-block">shift board</span>
    </Link>
  );
}