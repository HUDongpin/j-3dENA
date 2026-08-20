import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FlaskConical, Laptop2 } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description: "The purpose, technical boundary, and verification status of 3D ENA Next.",
};

export default function AboutPage() {
  return (
    <main id="main-content" className="site-main" data-testid="route-main">
      <section className="page-hero section-shell page-hero--split about-hero">
        <div>
          <p className="eyebrow">About 3D ENA Next</p>
          <h1>Research software built for a browser-native future.</h1>
          <p className="page-lede">
            3D ENA Next brings raw-data mapping, ENA computation, shared-space
            trajectories, and interactive results into a reusable TypeScript
            stack.
          </p>
          <Link className="button button--primary" href="/app">
            Open workspace <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="runtime-diagram" aria-label="Production runtime boundary">
          <Laptop2 size={32} aria-hidden="true" />
          <strong>Production runtime</strong>
          <span>Next.js · React · TypeScript</span>
          <span>Web Worker · jENA · Plotly.js</span>
          <small>Computation remains in the browser.</small>
        </div>
      </section>

      <section className="about-grid section-shell">
        <article>
          <CheckCircle2 size={25} aria-hidden="true" />
          <p className="eyebrow">Runtime boundary</p>
          <h2>Browser-only production analysis</h2>
          <p>
            The locally verified production build and runtime require no external
            statistical-computation service. ENA runs entirely in a dedicated
            browser Worker.
          </p>
        </article>
        <article>
          <FlaskConical size={25} aria-hidden="true" />
          <p className="eyebrow">Scientific migration</p>
          <h2>Oracle, not runtime</h2>
          <p>
            The prior implementation is retained only as an offline frozen
            scientific oracle used to generate and validate static golden fixtures.
          </p>
        </article>
        <article>
          <Laptop2 size={25} aria-hidden="true" />
          <p className="eyebrow">Evidence status</p>
          <h2>Verification remains visible</h2>
          <p>
            Product behavior can be exercised now, while scientific parity is
            explicitly marked as in progress until golden comparisons pass.
          </p>
        </article>
      </section>

      <section className="research-note section-shell">
        <div>
          <p className="eyebrow">Project principle</p>
          <blockquote>
            Analytical choices, computational ownership, and evidence status
            should be inspectable—not hidden behind a polished figure.
          </blockquote>
        </div>
        <Link className="text-link" href="/papers">
          Review the research <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
