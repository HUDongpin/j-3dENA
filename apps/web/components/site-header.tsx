"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, ExternalLink } from "lucide-react";

const navigation = [
  { href: "/", label: "Home" },
  { href: "/app", label: "Workspace" },
  { href: "/papers", label: "Papers" },
  { href: "/team", label: "Team" },
  { href: "/about", label: "About" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="3D ENA home">
          <span className="brand__mark" aria-hidden="true">
            <Box size={24} strokeWidth={1.7} />
          </span>
          <span className="brand__copy">
            <strong>3D ENA</strong>
            <small>Epistemic Network Analysis</small>
          </span>
        </Link>

        <nav aria-label="Primary navigation">
          <ul className="primary-nav">
            {navigation.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={active ? "is-active" : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <a
          className="header-source-link"
          href="https://www.ena3d.org/"
          target="_blank"
          rel="noreferrer"
        >
          Project site <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
    </header>
  );
}
