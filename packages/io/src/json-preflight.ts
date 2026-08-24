import { exchangeError } from "./errors";
import { ENA3D_EXCHANGE_V1_MAX_JSON_DEPTH } from "./limits";

const JSON_WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/**
 * Complete, non-materializing JSON grammar scan. It runs before JSON.parse so
 * duplicate keys and excessive depth cannot be normalized away by the host
 * parser. Only object keys are decoded; all other values are scanned in place.
 */
export function preflightJsonText(text: string): void {
  new JsonPreflightScanner(text).scanDocument();
}

class JsonPreflightScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  scanDocument(): void {
    this.skipWhitespace();
    this.scanValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.invalidJson();
  }

  private scanValue(depth: number): void {
    const token = this.text[this.index];
    if (token === "{") {
      this.scanObject(depth + 1);
    } else if (token === "[") {
      this.scanArray(depth + 1);
    } else if (token === '"') {
      this.scanString(false);
    } else if (token === "t") {
      this.scanLiteral("true");
    } else if (token === "f") {
      this.scanLiteral("false");
    } else if (token === "n") {
      this.scanLiteral("null");
    } else if (token === "-" || (token !== undefined && /[0-9]/.test(token))) {
      this.scanNumber();
    } else {
      this.invalidJson();
    }
  }

  private enterContainer(depth: number): void {
    if (depth > ENA3D_EXCHANGE_V1_MAX_JSON_DEPTH) {
      exchangeError(
        "JSON_TOO_DEEP",
        `JSON nesting exceeds the maximum depth of ${ENA3D_EXCHANGE_V1_MAX_JSON_DEPTH}.`,
      );
    }
  }

  private scanObject(depth: number): void {
    this.enterContainer(depth);
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return;
    }

    const keys = new Set<string>();
    while (this.index < this.text.length) {
      if (this.text[this.index] !== '"') this.invalidJson();
      const key = this.scanString(true);
      if (keys.has(key)) {
        exchangeError(
          "DUPLICATE_JSON_KEY",
          "A JSON object contains a duplicate key.",
        );
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.invalidJson();
      this.index += 1;
      this.skipWhitespace();
      this.scanValue(depth);
      this.skipWhitespace();
      const separator = this.text[this.index];
      if (separator === "}") {
        this.index += 1;
        return;
      }
      if (separator !== ",") this.invalidJson();
      this.index += 1;
      this.skipWhitespace();
    }
    this.invalidJson();
  }

  private scanArray(depth: number): void {
    this.enterContainer(depth);
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (this.index < this.text.length) {
      this.scanValue(depth);
      this.skipWhitespace();
      const separator = this.text[this.index];
      if (separator === "]") {
        this.index += 1;
        return;
      }
      if (separator !== ",") this.invalidJson();
      this.index += 1;
      this.skipWhitespace();
    }
    this.invalidJson();
  }

  private scanString(collect: boolean): string {
    this.index += 1;
    const chunks: string[] = [];
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      this.index += 1;
      if (code === 0x22) return collect ? chunks.join("") : "";
      if (code < 0x20) this.invalidJson();
      if (code !== 0x5c) {
        if (collect) chunks.push(String.fromCharCode(code));
        continue;
      }

      if (this.index >= this.text.length) this.invalidJson();
      const escaped = this.text[this.index];
      this.index += 1;
      const simple = escaped === undefined ? undefined : SIMPLE_ESCAPES[escaped];
      if (simple !== undefined) {
        if (collect) chunks.push(simple);
        continue;
      }
      if (escaped !== "u" || this.index + 4 > this.text.length) {
        this.invalidJson();
      }
      const hexadecimal = this.text.slice(this.index, this.index + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) this.invalidJson();
      this.index += 4;
      if (collect) chunks.push(String.fromCharCode(Number.parseInt(hexadecimal, 16)));
    }
    this.invalidJson();
  }

  private scanLiteral(expected: string): void {
    if (this.text.slice(this.index, this.index + expected.length) !== expected) {
      this.invalidJson();
    }
    this.index += expected.length;
  }

  private scanNumber(): void {
    if (this.text[this.index] === "-") this.index += 1;
    if (this.text[this.index] === "0") {
      this.index += 1;
      if (/[0-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
    } else {
      if (!/[1-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
      while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
    }
    if (this.text[this.index] === ".") {
      this.index += 1;
      if (!/[0-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
      while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
    }
    if (this.text[this.index] === "e" || this.text[this.index] === "E") {
      this.index += 1;
      if (this.text[this.index] === "+" || this.text[this.index] === "-") {
        this.index += 1;
      }
      if (!/[0-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
      while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
    }
  }

  private skipWhitespace(): void {
    while (JSON_WHITESPACE.has(this.text[this.index] ?? "")) this.index += 1;
  }

  private invalidJson(): never {
    exchangeError("INVALID_JSON", "The JSON syntax is invalid.");
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});
