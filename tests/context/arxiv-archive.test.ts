import { describe, expect, it } from "vitest";
import { gunzip, untar, extractArchive } from "../../src/context/arxiv-archive";

// Build a minimal one-file tar in memory.
function makeTar(name: string, body: string): Uint8Array {
  const enc = new TextEncoder();
  const header = new Uint8Array(512);
  header.set(enc.encode(name), 0);
  header.set(enc.encode("0000644"), 100); // mode
  header.set(enc.encode(body.length.toString(8).padStart(11, "0")), 124); // size (octal)
  header[156] = "0".charCodeAt(0); // type flag: regular file
  header.set(enc.encode("ustar\0"), 257); // magic
  // checksum: sum of header bytes with the checksum field treated as spaces
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (const b of header) sum += b;
  header.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  const data = enc.encode(body);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length + 1024);
  out.set(header, 0);
  out.set(padded, 512);
  return out;
}

describe("untar", () => {
  it("extracts a regular file", () => {
    const files = untar(makeTar("main.tex", "HELLO"));
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("main.tex");
    expect(new TextDecoder().decode(files[0].bytes)).toBe("HELLO");
  });
});

describe("gunzip + extractArchive", () => {
  it("round-trips through a gzip compression stream", async () => {
    const original = new TextEncoder().encode("compress me ".repeat(20));
    const cs = new Blob([original]).stream().pipeThrough(new CompressionStream("gzip"));
    const gz = new Uint8Array(await new Response(cs).arrayBuffer());
    expect(gz[0]).toBe(0x1f);
    const back = await gunzip(gz);
    expect(new TextDecoder().decode(back)).toBe("compress me ".repeat(20));
  });

  it("extractArchive treats a bare .tex payload as main.tex", async () => {
    const files = await extractArchive(new TextEncoder().encode("\\documentclass{x}"));
    expect(files[0].path).toBe("main.tex");
  });
});
