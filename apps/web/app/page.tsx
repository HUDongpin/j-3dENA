import Link from "next/link";
import {
  ArrowRight,
  Binary,
  Clock3,
  Cuboid,
  FileCheck2,
  Settings2,
} from "lucide-react";
import { NetworkPreview } from "@/components/network-preview";

export default function HomePage() {
  return (
    <main id="main-content" className="site-main" data-testid="route-main">
      <section className="hero section-shell">
        <div className="hero__copy">
          <p className="eyebrow">Browser-native research workspace</p>
          <h1>
            Make epistemic connections <em>visible in three dimensions.</em>
          </h1>
          <p className="hero__lede">
            Build an ENA model in the browser, inspect its shared SVD space, and
            trace ordered group centroids to study how knowledge structures move
            through time.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/app">
              Open the workspace <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="button button--secondary" href="/papers">
              Read the research
            </Link>
          </div>
          <div className="verification-note" role="status">
            <FileCheck2 size={19} aria-hidden="true" />
            <span>
              <strong>Scientific parity verification in progress.</strong> Browser
              results are not yet claimed as fully equivalent to the offline
              frozen scientific oracle.
            </span>
          </div>
        </div>

        <figure className="hero__visual">
          <div className="figure-heading">
            <div>
              <span>Trajectory analysis</span>
              <strong>One shared rotation</strong>
            </div>
            <span className="status-chip">Interactive in workspace</span>
          </div>
          <NetworkPreview />
          <figcaption>
            Schematic preview. The workspace renders computed points, nodes,
            edges, and group-time centroid paths with 2D and table alternatives.
          </figcaption>
        </figure>
      </section>

      <section className="method-section section-shell" aria-labelledby="method-title">
        <div className="section-heading">
          <p className="eyebrow">From raw rows to interpretation</p>
          <h2 id="method-title">A visible, reproducible analysis path</h2>
          <p>
            Dataset choices, ENA specification, execution ownership, and result
            provenance stay visible from import through export.
          </p>
        </div>
        <ol className="method-grid">
          <li>
            <span className="step-index">01</span>
            <Binary size={25} aria-hidden="true" />
            <h3>Load</h3>
            <p>Use the bundled small raw fixture or select a local CSV file.</p>
          </li>
          <li>
            <span className="step-index">02</span>
            <Settings2 size={25} aria-hidden="true" />
            <h3>Configure</h3>
            <p>Map units, conversations, codes, group, entity, and time.</p>
          </li>
          <li>
            <span className="step-index">03</span>
            <Cuboid size={25} aria-hidden="true" />
            <h3>Analyze</h3>
            <p>Run jENA through a dedicated module Worker outside React.</p>
          </li>
          <li>
            <span className="step-index">04</span>
            <Clock3 size={25} aria-hidden="true" />
            <h3>Interpret</h3>
            <p>Compare shared-space trajectories in 3D, 2D, or a data table.</p>
          </li>
        </ol>
      </section>

      <section className="research-note section-shell">
        <div>
          <p className="eyebrow">Designed for research</p>
          <blockquote>
            A visual analytics workspace should make complex relationships easier
            to examine while keeping analytical choices visible.
          </blockquote>
        </div>
        <Link className="text-link" href="/app">
          Begin an analysis <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
