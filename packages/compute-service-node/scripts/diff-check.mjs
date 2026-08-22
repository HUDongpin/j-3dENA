import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const checkedExtensions = new Set([".json", ".md", ".mjs", ".ts"]);
const ignoredDirectories = new Set(["dist", "node_modules"]);
const failures = [];

function visit(directoryUrl) {
  for (const entry of readdirSync(directoryUrl, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      visit(new URL(`${entryUrl.href}/`));
      continue;
    }
    if (!entry.isFile() || !checkedExtensions.has(extname(entry.name))) continue;
    const text = readFileSync(entryUrl, "utf8");
    const label = relative(root.pathname, entryUrl.pathname);
    if (!text.endsWith("\n")) failures.push(`${label}: missing final newline`);
    if (/\r/u.test(text)) failures.push(`${label}: carriage return`);
    if (/^(?:<{7}|={7}|>{7})(?: |$)/mu.test(text)) {
      failures.push(`${label}: conflict marker`);
    }
    for (const [index, line] of text.split("\n").entries()) {
      if (/[ \t]+$/u.test(line)) {
        failures.push(`${label}:${index + 1}: trailing whitespace`);
      }
    }
    if (extname(entry.name) === ".json") {
      try {
        JSON.parse(text);
      } catch {
        failures.push(`${label}: invalid JSON`);
      }
    }
  }
}

visit(root);
if (failures.length > 0) {
  throw new Error(`Package diff check failed:\n${failures.join("\n")}`);
}
