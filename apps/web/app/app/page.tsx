import type { Metadata } from "next";
import { AnalysisWorkspace } from "@/components/analysis-workspace";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Import, configure, run, inspect, and export a browser-native ENA analysis.",
};

export default function WorkspacePage() {
  return (
    <main
      id="main-content"
      className="site-main workspace-page"
      data-testid="route-main"
    >
      <AnalysisWorkspace />
    </main>
  );
}
