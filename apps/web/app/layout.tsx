import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { resolveBuildId } from "@/lib/build-identity";
import { PRODUCT_STATUS, THREEDENA_APP_ID } from "@/lib/evidence-scope";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "3D ENA — Epistemic Network Analysis",
    template: "%s · 3D ENA",
  },
  description:
    "A browser-native workspace for three-dimensional epistemic network analysis and shared-space group trajectories.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div
          className="app-shell"
          data-testid="app-shell"
          data-app-id={THREEDENA_APP_ID}
          data-build-id={resolveBuildId()}
          data-product-status={PRODUCT_STATUS}
        >
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          <SiteHeader />
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
