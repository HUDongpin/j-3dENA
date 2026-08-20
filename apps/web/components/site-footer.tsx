import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>3D ENA</strong>
        <span>Research visualization for epistemic network analysis</span>
      </div>
      <div className="site-footer__links">
        <Link href="/papers">Citation guidance</Link>
        <Link href="/about">Runtime boundary</Link>
      </div>
    </footer>
  );
}
