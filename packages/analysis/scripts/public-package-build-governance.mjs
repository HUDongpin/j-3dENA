import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const DETERMINISTIC_SCHEMA_MODULE_QUERY = "?schemas=public-package-contract-v1";
export const PUBLIC_METADATA_PATH_PLACEHOLDER = "[LOCAL_PATH_REDACTED]";
export const PUBLIC_METADATA_TEXT_MAX_LENGTH = 1_048_576;
export const PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH = 16_384;
export const PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS = 8;

const highConfidencePosixRootNames = [
  "Applications", "Library", "System", "Users", "Volumes",
  "bin", "boot", "data", "dev", "etc", "home", "lib", "lib32", "lib64",
  "media", "mnt", "nix", "opt", "private", "proc", "root", "run", "sbin",
  "snap", "srv", "sys", "tmp", "usr", "var", "workspace", "workspaces",
].join("|");
const commonPosixAbsolutePathPattern = new RegExp(
  String.raw`(?<![A-Za-z0-9+.-])\/(?:${highConfidencePosixRootNames})(?=\/|[\s\x60"'<>|)\]},;:]|$)(?:\/[^\s\x60"'<>|)\]}]+)*`,
  "giu",
);
const unambiguousPathLabelNames = Object.freeze([
  "cwd", "pwd", "path", "input", "output", "directory", "dir",
  "workspace", "repo", "repository", "root",
]);
const ambiguousPathLabelNames = Object.freeze(["home", "file", "source"]);
const windowsDriveAbsolutePathPattern =
  /(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/][^\s`"'<>|)\]}]+/gu;
const windowsUncAbsolutePathPattern =
  /(?<![\\A-Za-z0-9])\\\\[^\s`"'<>|)\]}]+/gu;
const forwardSlashUncAbsolutePathPattern =
  /(?<![:/])\/\/[^/\s`"'<>|)\]}]+\/[^\s`"'<>|)\]}]+/gu;
const simpleUnquotedAbsolutePathPatterns = Object.freeze([
  forwardSlashUncAbsolutePathPattern,
  windowsUncAbsolutePathPattern,
  windowsDriveAbsolutePathPattern,
  commonPosixAbsolutePathPattern,
]);
const quotedTextPattern = /`[^`\r\n]*`|"[^"\r\n]*"|'[^'\r\n]*'/gu;
const remainingHttpSchemeDetector = /https?:\/\//iu;
const metadataContinuationCharacterPattern = /[\p{L}\p{M}\p{N}\p{Pc}+.\-:]/u;
const pathLabelSemanticSuffixMaxCodeUnits = 64;
const fileUrlDetector = /\bfile:(?=\S)/iu;
const privateKeyMarker =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/iu;
const highConfidenceCredentialPatterns = Object.freeze([
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{82,255}\b/u,
  /\bsk-(?:(?:proj|svcacct|ant)-)?[A-Za-z0-9_-]{20,}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/u,
]);

const forbiddenIdentityVariables = Object.freeze([
  "THREEDENA_PACKAGE_BUILD_ID",
  "THREEDENA_PUBLIC_VERSION",
]);

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_BUILD_FAILED: ${message}`);
}

function metadataFail(message) {
  throw new Error(`PUBLIC_METADATA_HYGIENE_FAILED: ${message}`);
}

function strictUtf8(bytes, label) {
  if (!(bytes instanceof Uint8Array)) metadataFail(`${label} must be a byte array`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    metadataFail(`${label} must be strict UTF-8`);
  }
}

function requireDigest(value, label, length) {
  const pattern = length === 40 ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u;
  if (typeof value !== "string" || !pattern.test(value)) {
    metadataFail(`${label} must be a lowercase ${length === 40 ? "Git commit" : "SHA-256"}`);
  }
  return value;
}

function isAbsoluteFilesystemPath(text) {
  return (
    /^\/(?!\/)/u.test(text)
    || /^\/\/[^/\s]+\/[^/\s]+/u.test(text)
    || /^[A-Za-z]:[\\/]/u.test(text)
    || /^\\\\/u.test(text)
  );
}

function containsQuotedAbsolutePath(text) {
  for (const match of text.matchAll(quotedTextPattern)) {
    if (isAbsoluteFilesystemPath(match[0].slice(1, -1))) return true;
  }
  return false;
}

function codePointBefore(text, index) {
  if (index <= 0) return "";
  let start = index - 1;
  const trailingUnit = text.charCodeAt(start);
  if (
    trailingUnit >= 0xDC00
    && trailingUnit <= 0xDFFF
    && start > 0
  ) {
    const leadingUnit = text.charCodeAt(start - 1);
    if (leadingUnit >= 0xD800 && leadingUnit <= 0xDBFF) start -= 1;
  }
  return text.slice(start, index);
}

function isMetadataContinuationCharacter(character) {
  return character !== "" && metadataContinuationCharacterPattern.test(character);
}

function appendPathLabelSemanticCharacter(suffix, character) {
  if (character === "\n" || character === "\r") return "";
  if (character === "*" || character === "`") return suffix;
  const semanticCharacter = character === " " || character === "\t" ? " " : character;
  if (semanticCharacter === " " && suffix.endsWith(" ")) return suffix;
  const next = `${suffix}${semanticCharacter}`;
  if (next.length <= pathLabelSemanticSuffixMaxCodeUnits) return next;
  let start = next.length - pathLabelSemanticSuffixMaxCodeUnits;
  const firstUnit = next.charCodeAt(start);
  if (firstUnit >= 0xDC00 && firstUnit <= 0xDFFF) start += 1;
  return next.slice(start);
}

function hasExplicitPathLabelSuffix(suffix) {
  let labelEnd = suffix.length;
  const hadTrailingWhitespace = suffix.endsWith(" ");
  if (hadTrailingWhitespace) labelEnd -= 1;
  let explicitSeparator = false;
  if (suffix.slice(0, labelEnd).endsWith("->")) {
    explicitSeparator = true;
    labelEnd -= 2;
    if (suffix[labelEnd - 1] === " ") labelEnd -= 1;
  } else if (suffix[labelEnd - 1] === ":" || suffix[labelEnd - 1] === "=") {
    explicitSeparator = true;
    labelEnd -= 1;
    if (suffix[labelEnd - 1] === " ") labelEnd -= 1;
  } else if (!hadTrailingWhitespace) {
    return false;
  }

  const labelGroups = explicitSeparator
    ? [unambiguousPathLabelNames, ambiguousPathLabelNames]
    : [unambiguousPathLabelNames];
  for (const names of labelGroups) {
    for (const name of names) {
      const labelStart = labelEnd - name.length;
      if (labelStart < 0) continue;
      if (suffix.slice(labelStart, labelEnd).toLowerCase() !== name) continue;
      const preceding = codePointBefore(suffix, labelStart);
      if (isMetadataContinuationCharacter(preceding)) continue;
      return true;
    }
  }
  return false;
}

function isUnquotedPathTerminator(character) {
  return /[\s\x60"'<>|)\]}]/u.test(character);
}

function labeledPosixAbsolutePathSpans(text) {
  const spans = [];
  let semanticSuffix = "";
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    const width = character.length;
    if (
      character === "/"
      && text[index + 1] !== "/"
      && hasExplicitPathLabelSuffix(semanticSuffix)
    ) {
      let end = index + 1;
      while (end < text.length && !isUnquotedPathTerminator(text[end])) end += 1;
      spans.push({ start: index, end });
      semanticSuffix = "";
      index = end;
      continue;
    }
    semanticSuffix = appendPathLabelSemanticCharacter(semanticSuffix, character);
    index += width;
  }
  return spans;
}

function containsUnquotedAbsolutePath(text) {
  return (
    simpleUnquotedAbsolutePathPatterns.some((pattern) => text.match(pattern) !== null)
    || labeledPosixAbsolutePathSpans(text).length > 0
  );
}

function assertSecretAndPrivateKeySafe(text, label) {
  if (privateKeyMarker.test(text)) metadataFail(`${label} contains a private-key marker`);
  if (highConfidenceCredentialPatterns.some((pattern) => pattern.test(text))) {
    metadataFail(`${label} contains a high-confidence credential pattern`);
  }
}

function assertNonPathSensitiveTextSafe(text, label) {
  if (fileUrlDetector.test(text)) metadataFail(`${label} contains a file URL`);
  assertSecretAndPrivateKeySafe(text, label);
}

function assertSensitiveTextSafe(text, label, {
  allowLocalAbsolutePaths = false,
  allowStandaloneHttpUrl = false,
} = {}) {
  if (!allowStandaloneHttpUrl && remainingHttpSchemeDetector.test(text)) {
    metadataFail(`${label} contains a malformed or non-standalone HTTP(S) URL`);
  }
  assertNonPathSensitiveTextSafe(text, label);
  if (
    !allowLocalAbsolutePaths
    && (containsQuotedAbsolutePath(text) || containsUnquotedAbsolutePath(text))
  ) {
    metadataFail(`${label} contains a local absolute path`);
  }
}

function hexNibble(character) {
  const code = character?.charCodeAt(0) ?? -1;
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

function hasLegalPercentEscapeAt(text, index) {
  return (
    text[index] === "%"
    && hexNibble(text[index + 1]) >= 0
    && hexNibble(text[index + 2]) >= 0
  );
}

function decodeLegalPercentEscapes(text) {
  const chunks = [];
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = 0;
  let literalStart = 0;
  while (cursor < text.length) {
    if (!hasLegalPercentEscapeAt(text, cursor)) {
      cursor += 1;
      continue;
    }
    if (literalStart < cursor) chunks.push(text.slice(literalStart, cursor));
    const bytes = [];
    while (hasLegalPercentEscapeAt(text, cursor)) {
      bytes.push(hexNibble(text[cursor + 1]) * 16 + hexNibble(text[cursor + 2]));
      cursor += 3;
    }
    if (bytes.every((byte) => byte <= 0x7F)) {
      chunks.push(bytes.map((byte) => String.fromCharCode(byte)).join(""));
    } else {
      try {
        chunks.push(utf8Decoder.decode(Uint8Array.from(bytes)));
      } catch {
        chunks.push(bytes.map((byte) => String.fromCharCode(byte)).join(""));
      }
    }
    literalStart = cursor;
  }
  if (literalStart < text.length) chunks.push(text.slice(literalStart));
  return chunks.join("");
}

function assertPercentEncodedTokenLengthBounds(text, label) {
  for (let index = 0; index < text.length; index += 1) {
    if (!hasLegalPercentEscapeAt(text, index)) continue;
    let start = index;
    while (start > 0 && !isHttpTokenTerminator(text[start - 1])) start -= 1;
    let end = index + 3;
    while (end < text.length && !isHttpTokenTerminator(text[end])) end += 1;
    if (end - start > PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH) {
      metadataFail(
        `${label} percent-encoded token exceeds ${PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH} UTF-16 code units`,
      );
    }
    index = end - 1;
  }
}

function decodePermissivePercentEscapesToFixedPoint(text, label, maximumLength) {
  if (text.length > maximumLength) {
    metadataFail(`${label} exceeds ${maximumLength} UTF-16 code units`);
  }
  const decoded = [text];
  let current = text;
  for (let depth = 0; depth < PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS; depth += 1) {
    const next = decodeLegalPercentEscapes(current);
    if (next.length > maximumLength) {
      metadataFail(`${label} exceeds ${maximumLength} UTF-16 code units after decoding`);
    }
    if (next === current) return decoded;
    decoded.push(next);
    current = next;
  }
  metadataFail(
    `${label} did not stabilize within ${PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS} decoding iterations`,
  );
}

export function decodePublicMetadataPercentEscapesToFixedPoint(
  text,
  label = "public metadata",
) {
  if (typeof text !== "string") metadataFail(`${label} must be text`);
  return decodePermissivePercentEscapesToFixedPoint(
    text,
    label,
    PUBLIC_METADATA_TEXT_MAX_LENGTH,
  );
}

function decodeMetadataTextToFixedPoint(component, label) {
  if (component.length > PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH) {
    metadataFail(
      `${label} exceeds ${PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH} UTF-16 code units`,
    );
  }
  const decoded = [component];
  let current = component;
  for (let depth = 0; depth < PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS; depth += 1) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      metadataFail(`${label} contains malformed URL escaping`);
    }
    if (next.length > PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH) {
      metadataFail(
        `${label} exceeds ${PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH} UTF-16 code units after decoding`,
      );
    }
    if (next === current) return decoded;
    decoded.push(next);
    current = next;
  }
  metadataFail(
    `${label} did not stabilize within ${PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS} decoding iterations`,
  );
}

function httpSchemeLengthAt(text, index) {
  const first = text.charCodeAt(index);
  if (first !== 0x68 && first !== 0x48) return 0;
  const asciiLower = (offset) => text.charCodeAt(index + offset) | 0x20;
  if (
    asciiLower(1) !== 0x74
    || asciiLower(2) !== 0x74
    || asciiLower(3) !== 0x70
  ) return 0;
  let cursor = index + 4;
  const next = text.charCodeAt(cursor);
  if (next === 0x73 || next === 0x53) cursor += 1;
  if (
    text.charCodeAt(cursor) === 0x3A
    && text.charCodeAt(cursor + 1) === 0x2F
    && text.charCodeAt(cursor + 2) === 0x2F
  ) return cursor + 3 - index;
  return 0;
}

function isHttpTokenBoundary(character) {
  return !isMetadataContinuationCharacter(character);
}

function isHttpTokenTerminator(character) {
  return /[\s<>"'`]/u.test(character);
}

function trimTrailingHttpSyntax(text, minimumLength) {
  const balances = new Map([[")", 0], ["]", 0], ["}", 0]]);
  for (const character of text) {
    if (character === "(") balances.set(")", balances.get(")") + 1);
    else if (character === "[") balances.set("]", balances.get("]") + 1);
    else if (character === "{") balances.set("}", balances.get("}") + 1);
    else if (balances.has(character)) {
      balances.set(character, balances.get(character) - 1);
    }
  }
  let end = text.length;
  while (end > minimumLength) {
    const trailing = text[end - 1];
    if (trailing === "." || trailing === "," || trailing === ";" || trailing === "!") {
      end -= 1;
      continue;
    }
    if (balances.has(trailing) && balances.get(trailing) < 0) {
      balances.set(trailing, balances.get(trailing) + 1);
      end -= 1;
      continue;
    }
    break;
  }
  return end;
}

export function scanStandaloneHttpUrls(text) {
  if (typeof text !== "string") metadataFail("HTTP scanner input must be text");
  if (text.length > PUBLIC_METADATA_TEXT_MAX_LENGTH) {
    metadataFail(
      `HTTP scanner input exceeds ${PUBLIC_METADATA_TEXT_MAX_LENGTH} UTF-16 code units`,
    );
  }
  const urls = [];
  for (let index = 0; index < text.length; index += 1) {
    const schemeLength = httpSchemeLengthAt(text, index);
    if (schemeLength === 0 || !isHttpTokenBoundary(codePointBefore(text, index))) continue;
    let rawEnd = index + schemeLength;
    while (rawEnd < text.length && !isHttpTokenTerminator(text[rawEnd])) rawEnd += 1;
    const token = text.slice(index, rawEnd);
    const tokenEnd = trimTrailingHttpSyntax(token, schemeLength);
    urls.push(Object.freeze({
      start: index,
      end: index + tokenEnd,
      text: token.slice(0, tokenEnd),
    }));
    index = rawEnd - 1;
  }
  return Object.freeze(urls);
}

function rawHttpUrlMetadataComponents(urlText) {
  const fragmentIndex = urlText.indexOf("#");
  const queryIndex = urlText.indexOf("?");
  const components = [];
  if (queryIndex >= 0 && (fragmentIndex < 0 || queryIndex < fragmentIndex)) {
    components.push([
      "query",
      urlText.slice(queryIndex + 1, fragmentIndex < 0 ? undefined : fragmentIndex),
    ]);
  }
  if (fragmentIndex >= 0) components.push(["fragment", urlText.slice(fragmentIndex + 1)]);
  return components;
}

function rawHttpUrlAuthorityAndPathComponents(urlText) {
  const authorityStart = urlText.indexOf("://") + 3;
  const authoritySuffix = urlText.slice(authorityStart);
  const suffixOffset = authoritySuffix.search(/[/?#]/u);
  const authorityEnd = suffixOffset < 0 ? urlText.length : authorityStart + suffixOffset;
  const authority = urlText.slice(authorityStart, authorityEnd);
  const components = [];
  const userinfoEnd = authority.lastIndexOf("@");
  if (userinfoEnd >= 0) {
    const userinfo = authority.slice(0, userinfoEnd);
    const passwordStart = userinfo.indexOf(":");
    if (passwordStart < 0) {
      components.push(["username", userinfo]);
    } else {
      components.push(["username", userinfo.slice(0, passwordStart)]);
      components.push(["password", userinfo.slice(passwordStart + 1)]);
    }
  }
  const hostAndPort = authority.slice(userinfoEnd + 1);
  let hostname;
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    hostname = closingBracket < 0 ? hostAndPort : hostAndPort.slice(1, closingBracket);
  } else {
    const portSeparator = hostAndPort.lastIndexOf(":");
    hostname = portSeparator < 0 ? hostAndPort : hostAndPort.slice(0, portSeparator);
  }
  components.push(["hostname", hostname]);
  if (urlText[authorityEnd] === "/") {
    const queryIndex = urlText.indexOf("?", authorityEnd);
    const fragmentIndex = urlText.indexOf("#", authorityEnd);
    const pathEnd = [queryIndex, fragmentIndex]
      .filter((index) => index >= 0)
      .reduce((minimum, index) => Math.min(minimum, index), urlText.length);
    components.push(["pathname", urlText.slice(authorityEnd, pathEnd)]);
  }
  return components;
}

function inspectDecodedSensitiveText(text, label) {
  assertSecretAndPrivateKeySafe(text, label);
  transformOutsideHttpUrls(
    text,
    (segment) => {
      assertSensitiveTextSafe(segment, label);
      return segment;
    },
    label,
  );
}

function inspectHttpNonPathComponents(urlText, label) {
  for (const [componentName, component] of rawHttpUrlAuthorityAndPathComponents(urlText)) {
    const componentLabel = `${label} HTTP(S) ${componentName}`;
    for (const decoded of decodeMetadataTextToFixedPoint(component, componentLabel)) {
      assertNonPathSensitiveTextSafe(decoded, componentLabel);
    }
  }
}

function inspectHttpMetadataComponent(component, componentName, label) {
  const componentLabel = `${label} HTTP(S) ${componentName}`;
  for (const decoded of decodeMetadataTextToFixedPoint(component, componentLabel)) {
    inspectDecodedSensitiveText(decoded, componentLabel);
    if (componentName === "query") {
      inspectDecodedSensitiveText(decoded.replace(/\+/gu, " "), `${componentLabel} form value`);
    }
  }
}

function transformOutsideHttpUrls(text, transform, label) {
  let cursor = 0;
  let result = "";
  for (const { start: index, end, text: urlText } of scanStandaloneHttpUrls(text)) {
    result += transform(text.slice(cursor, index));
    try {
      new URL(urlText);
    } catch {
      metadataFail(`${label} contains a malformed HTTP(S) URL`);
    }
    assertSensitiveTextSafe(urlText, label, {
      allowLocalAbsolutePaths: true,
      allowStandaloneHttpUrl: true,
    });
    inspectHttpNonPathComponents(urlText, label);
    for (const [componentName, component] of rawHttpUrlMetadataComponents(urlText)) {
      inspectHttpMetadataComponent(component, componentName, label);
    }
    result += urlText;
    cursor = end;
  }
  result += transform(text.slice(cursor));
  return result;
}

function inspectSensitiveMetadataText(text, label, { allowLocalAbsolutePaths = false } = {}) {
  const percentDecodedLayers = decodePublicMetadataPercentEscapesToFixedPoint(text, label);
  for (const [index, decoded] of percentDecodedLayers.entries()) {
    assertNonPathSensitiveTextSafe(decoded, label);
    if (index > 0) inspectDecodedSensitiveText(decoded, `${label} percent-decoded metadata`);
  }
  transformOutsideHttpUrls(
    text,
    (segment) => {
      assertSensitiveTextSafe(segment, label, { allowLocalAbsolutePaths });
      assertPercentEncodedTokenLengthBounds(segment, label);
      return segment;
    },
    label,
  );
}

function unquotedAbsolutePathSpans(text) {
  const spans = [];
  for (const pattern of simpleUnquotedAbsolutePathPatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length });
    }
  }
  spans.push(...labeledPosixAbsolutePathSpans(text));
  spans.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function replaceUnquotedAbsolutePaths(text, spans = unquotedAbsolutePathSpans(text)) {
  if (spans.length === 0) return text;
  const chunks = [];
  let cursor = 0;
  for (const { start, end } of spans) {
    chunks.push(text.slice(cursor, start), PUBLIC_METADATA_PATH_PLACEHOLDER);
    cursor = end;
  }
  chunks.push(text.slice(cursor));
  return chunks.join("");
}

function replaceQuotedAbsolutePaths(text, label) {
  return text.replace(quotedTextPattern, (quoted) => {
    const quote = quoted[0];
    const inner = quoted.slice(1, -1);
    if (isAbsoluteFilesystemPath(inner)) return PUBLIC_METADATA_PATH_PLACEHOLDER;
    const spans = unquotedAbsolutePathSpans(inner);
    assertNoAmbiguousUnquotedAbsolutePath(inner, label, spans);
    return `${quote}${replaceUnquotedAbsolutePaths(inner, spans)}${quote}`;
  });
}

function assertNoAmbiguousUnquotedAbsolutePath(
  text,
  label,
  spans = unquotedAbsolutePathSpans(text),
) {
  for (const { end } of spans) {
    let continuationStart = end;
    while (text[continuationStart] === " " || text[continuationStart] === "\t") {
      continuationStart += 1;
    }
    if (
      continuationStart === end
      || continuationStart >= text.length
      || /\s/u.test(text[continuationStart])
    ) continue;
    const twoCharacterOperator = text.slice(continuationStart, continuationStart + 2);
    let tokenLength;
    if (twoCharacterOperator === "&&" || twoCharacterOperator === "||") {
      tokenLength = 2;
    } else if (/^[|,;)\]}]$/u.test(text[continuationStart])) {
      tokenLength = 1;
    } else {
      metadataFail(`${label} contains an ambiguous unquoted absolute path`);
    }
    const afterToken = continuationStart + tokenLength;
    if (afterToken < text.length && !/\s/u.test(text[afterToken])) {
      metadataFail(`${label} contains an ambiguous unquoted absolute path`);
    }
  }
}

function sanitizeLocalMetadataSegment(text, label) {
  let result = replaceQuotedAbsolutePaths(text, label);
  const spans = unquotedAbsolutePathSpans(result);
  assertNoAmbiguousUnquotedAbsolutePath(result, label, spans);
  return replaceUnquotedAbsolutePaths(result, spans);
}

export function assertPublicMetadataHygiene(text, label = "public metadata") {
  if (typeof text !== "string") metadataFail(`${label} must be text`);
  inspectSensitiveMetadataText(text, label);
  return text;
}

export function sanitizeRedistributedJenaProvenance(originalBytes, receipt) {
  const originalText = strictUtf8(originalBytes, "upstream jENA provenance");
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    metadataFail("jENA receipt must be an object");
  }
  if (receipt.package !== "jena-js" || receipt.version !== "0.7.0-ona.0") {
    metadataFail("jENA receipt artifact identity is not reviewed");
  }
  const officialCommit = requireDigest(receipt.officialCommit, "jENA officialCommit", 40);
  const tarballSha256 = requireDigest(receipt.tarballSha256, "jENA tarballSha256", 64);
  const provenanceSha256 = requireDigest(receipt.provenanceSha256, "jENA provenanceSha256", 64);
  const actualProvenanceSha256 = createSha256(originalBytes);
  if (actualProvenanceSha256 !== provenanceSha256) {
    metadataFail("upstream jENA provenance SHA-256 differs from the reviewed receipt");
  }

  const normalizedOriginal = originalText.replace(/\r\n?/gu, "\n");
  inspectSensitiveMetadataText(
    normalizedOriginal,
    "upstream jENA provenance",
    { allowLocalAbsolutePaths: true },
  );
  let sanitizedBody = transformOutsideHttpUrls(
    normalizedOriginal,
    (segment) => sanitizeLocalMetadataSegment(segment, "upstream jENA provenance"),
    "upstream jENA provenance",
  );
  sanitizedBody = sanitizedBody.replace(/\n*$/u, "");
  const notice = [
    "# Redistribution privacy notice",
    "",
    "This file is a deterministic privacy-sanitized copy of the upstream jENA provenance document.",
    `Recognized high-confidence or explicitly path-labeled local filesystem paths are replaced in full with ${PUBLIC_METADATA_PATH_PLACEHOLDER}, retaining no path components; ambiguous unquoted path-like values fail closed.`,
    "The exact original provenance bytes remain inside the reviewed jENA tarball under hash custody and are not modified by this redistribution step.",
    "",
    `Reviewed artifact: ${receipt.package}@${receipt.version}`,
    `Official source commit: ${officialCommit}`,
    `Reviewed tarball SHA-256: ${tarballSha256}`,
    `Upstream original provenance SHA-256: ${provenanceSha256}`,
    "",
    "---",
    "",
    "",
  ].join("\n");
  const result = `${notice}${sanitizedBody}\n`;
  assertPublicMetadataHygiene(result, "redistributed jENA provenance");
  return result;
}

function createSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readGit(repositoryRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`unable to read source identity from Git: ${detail}`);
  }
}

function hasOwn(environment, name) {
  return Object.prototype.hasOwnProperty.call(environment, name);
}

export async function cleanPublicPackageBuildOutputs({ analysisDirectory, distributionDirectory }) {
  const expectedDistributionDirectory = resolve(analysisDirectory, "dist");
  const resolvedDistributionDirectory = resolve(distributionDirectory);
  if (
    resolvedDistributionDirectory !== expectedDistributionDirectory
    || dirname(resolvedDistributionDirectory) !== resolve(analysisDirectory)
    || resolvedDistributionDirectory.split(sep).at(-1) !== "dist"
  ) {
    fail("refusing to clean an unexpected distribution path");
  }

  try {
    const distribution = await lstat(resolvedDistributionDirectory);
    if (!distribution.isDirectory() || distribution.isSymbolicLink()) {
      fail("refusing to clean a non-directory or symbolic-link distribution path");
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }

  for (const directoryName of ["package", "schema-runtime"]) {
    const outputDirectory = resolve(resolvedDistributionDirectory, directoryName);
    if (
      dirname(outputDirectory) !== resolvedDistributionDirectory
      || outputDirectory.split(sep).at(-1) !== directoryName
    ) {
      fail(`refusing to clean an unexpected ${directoryName} path`);
    }
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

export function captureCleanSourceSnapshot({ repositoryRoot, environment = process.env }) {
  for (const variable of forbiddenIdentityVariables) {
    if (hasOwn(environment, variable)) fail(`${variable} is forbidden for source-governed builds`);
  }

  const repositoryHead = readGit(repositoryRoot, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(repositoryHead)) fail("HEAD is not a full Git commit identity");
  const sourceDateEpoch = readGit(repositoryRoot, ["show", "-s", "--format=%ct", repositoryHead]);
  if (!/^(?:0|[1-9]\d*)$/u.test(sourceDateEpoch)) fail("HEAD commit timestamp is invalid");
  if (hasOwn(environment, "SOURCE_DATE_EPOCH") && environment.SOURCE_DATE_EPOCH !== sourceDateEpoch) {
    fail("SOURCE_DATE_EPOCH must equal the HEAD commit timestamp");
  }
  const dirty = readGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.length > 0) fail("refusing to build a release package from a dirty worktree");

  const milliseconds = Number(sourceDateEpoch) * 1000;
  if (!Number.isFinite(milliseconds)) fail("HEAD commit timestamp is outside the Date range");
  return Object.freeze({
    repositoryHead,
    sourceDateEpoch,
    dirtyWorktree: false,
    generatedAt: new Date(milliseconds).toISOString(),
  });
}

function cleanAllowedDirtyPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    fail("allowed generated path must be a repository-relative POSIX path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("allowed generated path contains an unsafe segment");
  }
  return path;
}

export function assertSourceSnapshotUnchanged(snapshot, { repositoryRoot, allowedDirtyPaths = [] }) {
  const repositoryHead = readGit(repositoryRoot, ["rev-parse", "HEAD"]);
  const exclusions = allowedDirtyPaths.flatMap((candidate) => {
    const path = cleanAllowedDirtyPath(candidate);
    return [`:(exclude,top)${path}`, `:(exclude,top,glob)${path}/**`];
  });
  const dirty = readGit(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ...exclusions,
  ]);
  if (repositoryHead !== snapshot.repositoryHead || dirty.length > 0) {
    fail("source worktree changed during the build");
  }
  const sourceDateEpoch = readGit(repositoryRoot, ["show", "-s", "--format=%ct", repositoryHead]);
  if (sourceDateEpoch !== snapshot.sourceDateEpoch) fail("HEAD timestamp changed during the build");
}

export function compareCodePoints(left, right) {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  while (true) {
    const leftNext = leftIterator.next();
    const rightNext = rightIterator.next();
    if (leftNext.done || rightNext.done) {
      if (leftNext.done && rightNext.done) return 0;
      return leftNext.done ? -1 : 1;
    }
    const leftPoint = leftNext.value.codePointAt(0);
    const rightPoint = rightNext.value.codePointAt(0);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
}

function tarString(bytes, start, length) {
  const field = bytes.subarray(start, start + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function tarOctal(bytes, start, length, label) {
  const text = tarString(bytes, start, length).trim();
  if (!/^[0-7]+$/u.test(text)) fail(`invalid tar ${label}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid tar ${label}`);
  return value;
}

export function extractGzipTarEntry(archiveBytes, expectedPath) {
  const tar = gunzipSync(archiveBytes);
  let offset = 0;
  let result;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = tarOctal(header, 124, 12, `size for ${path}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) fail(`truncated tar entry ${path}`);
    if (path === expectedPath) {
      if (result !== undefined) fail(`vendored archive contains duplicate ${expectedPath}`);
      result = Buffer.from(tar.subarray(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (result === undefined) fail(`vendored archive does not contain ${expectedPath}`);
  return result;
}
