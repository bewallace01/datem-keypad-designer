// js/zip.js
// Minimal store-mode ZIP encoder. No compression (DAT/EM bitmaps are already
// tiny). One function: `buildZip(entries) -> Uint8Array`.
//
// `entries` is an array of `{ name: string, data: Uint8Array }`.
//
// We hand-write the three pieces of the ZIP format:
//   - one Local File Header (+ data) per entry
//   - one Central Directory Record per entry
//   - one End-of-Central-Directory Record at the end

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDate(d) {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}
function dosTime(d) {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | ((d.getSeconds() / 2) | 0);
}

export function buildZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const date = dosDate(now);
  const time = dosTime(now);

  const localHeaders = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0, true);
    ldv.setUint16(8, 0, true); // store
    ldv.setUint16(10, time, true);
    ldv.setUint16(12, date, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localHeaders.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralRecords.push(central);

    offset += local.length;
  }

  const centralStart = offset;
  let centralLen = 0;
  for (const c of centralRecords) centralLen += c.length;

  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralLen, true);
  edv.setUint32(16, centralStart, true);
  edv.setUint16(20, 0, true);

  const out = new Uint8Array(centralStart + centralLen + 22);
  let pos = 0;
  for (const l of localHeaders) { out.set(l, pos); pos += l.length; }
  for (const c of centralRecords) { out.set(c, pos); pos += c.length; }
  out.set(end, pos);
  return out;
}
