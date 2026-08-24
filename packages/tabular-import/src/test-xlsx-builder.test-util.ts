interface ZipPart {
  readonly name: string;
  readonly data: Uint8Array;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function xml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function storedZip(parts: readonly ZipPart[]): Uint8Array<ArrayBuffer> {
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;
  for (const part of parts) {
    const name = new TextEncoder().encode(part.name);
    const checksum = crc32(part.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(part.data.byteLength),
      u32(part.data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      part.data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(part.data.byteLength),
      u32(part.data.byteLength),
      u16(name.byteLength),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      name,
    ]);
    localRecords.push(local);
    centralRecords.push(central);
    localOffset += local.byteLength;
  }
  const centralDirectory = concat(centralRecords);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(parts.length),
    u16(parts.length),
    u32(centralDirectory.byteLength),
    u32(localOffset),
    u16(0),
  ]);
  return concat([...localRecords, centralDirectory, eocd]);
}

export function buildAdversarialXlsx(dataCellXml: string): Uint8Array<ArrayBuffer> {
  return storedZip([
    {
      name: "[Content_Types].xml",
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>",
      ),
    },
    {
      name: "_rels/.rels",
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "xl/workbook.xml",
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>' +
          "</workbook>",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<dimension ref="A1:A2"/><sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Value</t></is></c></row>' +
          `<row r="2">${dataCellXml}</row>` +
          "</sheetData></worksheet>",
      ),
    },
  ]);
}

export function patchFirstCentralUncompressedSize(
  original: Uint8Array,
  declaredSize: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(original);
  for (let offset = 0; offset <= bytes.byteLength - 28; offset += 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x01 &&
      bytes[offset + 3] === 0x02
    ) {
      bytes[offset + 24] = declaredSize & 0xff;
      bytes[offset + 25] = (declaredSize >>> 8) & 0xff;
      bytes[offset + 26] = (declaredSize >>> 16) & 0xff;
      bytes[offset + 27] = (declaredSize >>> 24) & 0xff;
      return bytes;
    }
  }
  throw new Error("Test fixture central directory not found.");
}

export function markFirstCentralEntryEncrypted(
  original: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(original);
  for (let offset = 0; offset <= bytes.byteLength - 10; offset += 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x01 &&
      bytes[offset + 3] === 0x02
    ) {
      const flags = (bytes[offset + 8] ?? 0) | ((bytes[offset + 9] ?? 0) << 8);
      const encryptedFlags = flags | 0x0001;
      bytes[offset + 8] = encryptedFlags & 0xff;
      bytes[offset + 9] = (encryptedFlags >>> 8) & 0xff;
      return bytes;
    }
  }
  throw new Error("Test fixture central directory not found.");
}
