// Decompress + unpack an arXiv e-print payload. Pure (no network, no disk):
// input is a byte buffer, output is a list of {path, bytes}.

import { gunzipSync } from "fflate";

export interface ArchiveFile {
  path: string;
  bytes: Uint8Array;
}

// Inflate a gzip buffer. Uses fflate (a tiny pure-JS implementation) rather
// than the platform `DecompressionStream` — that is NOT a global in Zotero's
// plugin sandbox (it exists in the chrome window scope, but not here).
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return gunzipSync(bytes);
}

// Parse the POSIX tar format: 512-byte header blocks, file data padded to
// 512. We keep regular files only (type flag '0' / NUL).
export function untar(buf: Uint8Array): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  const td = new TextDecoder();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const name = td.decode(header.subarray(0, 100)).replace(/\0.*$/s, "").trim();
    const sizeOctal = td.decode(header.subarray(124, 136)).replace(/[^0-7]/g, "");
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const typeFlag = String.fromCharCode(header[156]);
    off += 512;
    if (name && (typeFlag === "0" || typeFlag === "\0")) {
      files.push({ path: name, bytes: buf.subarray(off, off + size) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

// Detect gzip / tar / PDF / bare-file and produce the file list.
export async function extractArchive(bytes: Uint8Array): Promise<ArchiveFile[]> {
  let data = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) data = await gunzip(bytes);
  // %PDF — the submission has no LaTeX source
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return [];
  }
  const isTar =
    data.length >= 512 &&
    new TextDecoder().decode(data.subarray(257, 262)) === "ustar";
  if (isTar) return untar(data);
  // A single-file arXiv source: a bare .tex.
  return [{ path: "main.tex", bytes: data }];
}
