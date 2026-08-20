import type { AnalysisMapping } from "@/lib/analysis-contract";

export const BUILT_IN_SAMPLE_NAME = "small-raw.csv";

export const BUILT_IN_SAMPLE_CSV = `"Group","Lesson","Name","EC","ICT","MCO","ATT"
"Experimental","Lesson 1","Student 1",0,0,1,1
"Control","Lesson 1","Student 1",1,0,0,1
"Experimental","Lesson 2","Student 1",0,1,0,0
"Control","Lesson 2","Student 1",1,1,1,0
"Experimental","Lesson 1","Student 2",1,0,1,1
"Control","Lesson 1","Student 2",1,1,0,1
"Experimental","Lesson 2","Student 2",0,0,0,1
"Control","Lesson 2","Student 2",1,1,1,0
"Experimental","Lesson 1","Student 3",0,1,1,0
"Control","Lesson 1","Student 3",1,0,0,1
"Experimental","Lesson 2","Student 3",0,0,0,1
"Control","Lesson 2","Student 3",1,1,1,1
"Experimental","Lesson 1","Student 4",0,0,1,0
"Control","Lesson 1","Student 4",1,0,0,0
"Experimental","Lesson 2","Student 4",1,1,0,1
"Control","Lesson 2","Student 4",1,1,1,1
`;

export const LEGACY_DEFAULT_MAPPING: AnalysisMapping = {
  unitColumns: ["Group", "Name"],
  conversationColumns: ["Lesson"],
  codeColumns: ["EC", "ICT", "MCO", "ATT"],
  groupColumn: "Group",
  timeColumn: "Lesson",
  entityColumn: "Name",
  model: "AccumulatedTrajectory",
  window: "MovingStanzaWindow",
  windowSizeBack: 4,
};

function present(headers: string[], values: string[]): string[] {
  return values.filter((value) => headers.includes(value));
}

export function mappingForHeaders(headers: string[]): AnalysisMapping {
  const unitColumns = present(headers, LEGACY_DEFAULT_MAPPING.unitColumns);
  const conversationColumns = present(
    headers,
    LEGACY_DEFAULT_MAPPING.conversationColumns,
  );
  const codeColumns = present(headers, LEGACY_DEFAULT_MAPPING.codeColumns);
  const fallbackCodes = headers.filter(
    (header) =>
      !new Set([
        ...unitColumns,
        ...conversationColumns,
        LEGACY_DEFAULT_MAPPING.groupColumn,
      ]).has(header),
  );

  return {
    ...LEGACY_DEFAULT_MAPPING,
    unitColumns: unitColumns.length > 0 ? unitColumns : headers.slice(0, 1),
    conversationColumns:
      conversationColumns.length > 0
        ? conversationColumns
        : headers.slice(1, 2),
    codeColumns:
      codeColumns.length >= 3 ? codeColumns : fallbackCodes.slice(0, 4),
    groupColumn: headers.includes("Group") ? "Group" : (headers[0] ?? ""),
    timeColumn: headers.includes("Lesson") ? "Lesson" : (headers[1] ?? ""),
    entityColumn: headers.includes("Name") ? "Name" : (headers[0] ?? ""),
  };
}
