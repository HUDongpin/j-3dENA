"use client";

import { type KeyboardEvent } from "react";
import {
  RESULT_SECTIONS,
  type ResultSection,
} from "@/lib/result-plot-tools";

interface ResultExplorerTabsProps {
  active: ResultSection;
  idPrefix: string;
  onSelect: (section: ResultSection) => void;
}

export function ResultExplorerTabs({
  active,
  idPrefix,
  onSelect,
}: ResultExplorerTabsProps) {
  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    current: ResultSection,
  ): void {
    const currentIndex = RESULT_SECTIONS.findIndex((section) => section.id === current);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % RESULT_SECTIONS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + RESULT_SECTIONS.length) % RESULT_SECTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = RESULT_SECTIONS.length - 1;
    }
    if (nextIndex === undefined) return;
    const next = RESULT_SECTIONS[nextIndex];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
    });
  }

  return (
    <div
      className="result-section-tabs"
      role="tablist"
      aria-label="Analysis result sections"
      data-testid="result-section-tabs"
    >
      {RESULT_SECTIONS.map((section) => (
        <button
          key={section.id}
          id={`${idPrefix}-tab-${section.id}`}
          type="button"
          role="tab"
          aria-selected={active === section.id}
          aria-controls={`${idPrefix}-panel-${section.id}`}
          tabIndex={active === section.id ? 0 : -1}
          onClick={() => onSelect(section.id)}
          onKeyDown={(event) => handleKeyDown(event, section.id)}
          data-testid={`result-tab-${section.id}`}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}

interface ResultPanelProps {
  active: ResultSection;
  section: ResultSection;
  idPrefix: string;
  className?: string;
  children: React.ReactNode;
}

export function ResultPanel({
  active,
  section,
  idPrefix,
  className,
  children,
}: ResultPanelProps) {
  return (
    <div
      id={`${idPrefix}-panel-${section}`}
      className={className ? `result-section-panel ${className}` : "result-section-panel"}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${section}`}
      hidden={active !== section}
      tabIndex={0}
      data-result-section={section}
    >
      {children}
    </div>
  );
}
