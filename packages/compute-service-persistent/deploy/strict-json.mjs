const JSON_WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const MAXIMUM_JSON_DEPTH = 64;
const SIMPLE_ESCAPES = Object.freeze({
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});

/**
 * Runs a complete token-level grammar scan before JSON.parse. Object keys are
 * decoded while scanning so spelling variants such as `key` and `\u006bey`
 * cannot be normalized into an undetected duplicate by JSON.parse.
 */
export function parseStrictJson(input) {
  const text = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true }).decode(input);
  new StrictJsonScanner(text).scanDocument();
  return JSON.parse(text);
}

class StrictJsonScanner {
  #index = 0;

  constructor(text) {
    this.text = text;
  }

  scanDocument() {
    this.#skipWhitespace();
    this.#scanValue(0);
    this.#skipWhitespace();
    if (this.#index !== this.text.length) this.#invalid();
  }

  #scanValue(depth) {
    const token = this.text[this.#index];
    if (token === "{") this.#scanObject(depth + 1);
    else if (token === "[") this.#scanArray(depth + 1);
    else if (token === '"') this.#scanString(false);
    else if (token === "t") this.#scanLiteral("true");
    else if (token === "f") this.#scanLiteral("false");
    else if (token === "n") this.#scanLiteral("null");
    else if (token === "-" || (token !== undefined && /[0-9]/u.test(token))) {
      this.#scanNumber();
    } else this.#invalid();
  }

  #enterContainer(depth) {
    if (depth > MAXIMUM_JSON_DEPTH) this.#invalid();
  }

  #scanObject(depth) {
    this.#enterContainer(depth);
    this.#index += 1;
    this.#skipWhitespace();
    if (this.text[this.#index] === "}") {
      this.#index += 1;
      return;
    }
    const keys = new Set();
    while (this.#index < this.text.length) {
      if (this.text[this.#index] !== '"') this.#invalid();
      const key = this.#scanString(true);
      if (keys.has(key)) this.#invalid();
      keys.add(key);
      this.#skipWhitespace();
      if (this.text[this.#index] !== ":") this.#invalid();
      this.#index += 1;
      this.#skipWhitespace();
      this.#scanValue(depth);
      this.#skipWhitespace();
      const separator = this.text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return;
      }
      if (separator !== ",") this.#invalid();
      this.#index += 1;
      this.#skipWhitespace();
    }
    this.#invalid();
  }

  #scanArray(depth) {
    this.#enterContainer(depth);
    this.#index += 1;
    this.#skipWhitespace();
    if (this.text[this.#index] === "]") {
      this.#index += 1;
      return;
    }
    while (this.#index < this.text.length) {
      this.#scanValue(depth);
      this.#skipWhitespace();
      const separator = this.text[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return;
      }
      if (separator !== ",") this.#invalid();
      this.#index += 1;
      this.#skipWhitespace();
    }
    this.#invalid();
  }

  #scanString(collect) {
    this.#index += 1;
    const chunks = [];
    while (this.#index < this.text.length) {
      const code = this.text.charCodeAt(this.#index);
      this.#index += 1;
      if (code === 0x22) return collect ? chunks.join("") : "";
      if (code < 0x20) this.#invalid();
      if (code !== 0x5c) {
        if (collect) chunks.push(String.fromCharCode(code));
        continue;
      }
      if (this.#index >= this.text.length) this.#invalid();
      const escaped = this.text[this.#index];
      this.#index += 1;
      const simple = escaped === undefined ? undefined : SIMPLE_ESCAPES[escaped];
      if (simple !== undefined) {
        if (collect) chunks.push(simple);
        continue;
      }
      if (escaped !== "u" || this.#index + 4 > this.text.length) this.#invalid();
      const hexadecimal = this.text.slice(this.#index, this.#index + 4);
      if (!/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) this.#invalid();
      this.#index += 4;
      if (collect) chunks.push(String.fromCharCode(Number.parseInt(hexadecimal, 16)));
    }
    this.#invalid();
  }

  #scanLiteral(expected) {
    if (this.text.slice(this.#index, this.#index + expected.length) !== expected) {
      this.#invalid();
    }
    this.#index += expected.length;
  }

  #scanNumber() {
    if (this.text[this.#index] === "-") this.#index += 1;
    if (this.text[this.#index] === "0") {
      this.#index += 1;
      if (/[0-9]/u.test(this.text[this.#index] ?? "")) this.#invalid();
    } else {
      if (!/[1-9]/u.test(this.text[this.#index] ?? "")) this.#invalid();
      while (/[0-9]/u.test(this.text[this.#index] ?? "")) this.#index += 1;
    }
    if (this.text[this.#index] === ".") {
      this.#index += 1;
      if (!/[0-9]/u.test(this.text[this.#index] ?? "")) this.#invalid();
      while (/[0-9]/u.test(this.text[this.#index] ?? "")) this.#index += 1;
    }
    if (this.text[this.#index] === "e" || this.text[this.#index] === "E") {
      this.#index += 1;
      if (this.text[this.#index] === "+" || this.text[this.#index] === "-") {
        this.#index += 1;
      }
      if (!/[0-9]/u.test(this.text[this.#index] ?? "")) this.#invalid();
      while (/[0-9]/u.test(this.text[this.#index] ?? "")) this.#index += 1;
    }
  }

  #skipWhitespace() {
    while (JSON_WHITESPACE.has(this.text[this.#index] ?? "")) this.#index += 1;
  }

  #invalid() {
    throw new SyntaxError("strict JSON is invalid or contains duplicate object keys");
  }
}
