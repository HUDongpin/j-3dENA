import type { ENAModel, ENAWindow } from "@3dena/analysis";

export interface AnalysisMapping {
  unitColumns: string[];
  conversationColumns: string[];
  codeColumns: string[];
  groupColumn: string;
  timeColumn: string;
  entityColumn: string;
  model: ENAModel;
  window: ENAWindow;
  windowSizeBack: number;
}
