export const MAX_CACHE_ENTRIES = 500;

export interface CacheEntry {
  text: string;
  model: string;
  createdAt: number;
}

interface CacheState {
  entries: Record<string, CacheEntry>;
}

interface CacheKeyInput {
  sentence: string;
  target: string;
  endpoint: string;
  model: string;
  thinking: string;
  ctxLevel: string;
}

interface ZoteroFileAPI {
  getContentsAsync(path: string, charset?: string): Promise<string>;
  putContentsAsync(path: string, contents: string): Promise<void>;
}

interface ZoteroGlobal {
  File: ZoteroFileAPI;
  DataDirectory?: { dir?: string; path?: string };
  Profile: { dir: string };
}

// Synchronous FNV-1a-style 64-bit hex digest. Cache keys need stability
// and low collision rate, not crypto strength — and we run in environments
// where WebCrypto's sync API is unavailable.
function fnv1aHex64(input: string): string {
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 0x9e37), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function normalizeSentence(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function cacheKey(input: CacheKeyInput): string {
  const payload = [
    normalizeSentence(input.sentence),
    input.target,
    input.endpoint,
    input.model,
    input.thinking,
    input.ctxLevel,
  ].join('|');
  return fnv1aHex64(payload).slice(0, 16);
}

const CACHE_FILE = 'zotero-ai-sidebar-translate-cache.json';
let writeQueue: Promise<void> = Promise.resolve();

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

export function translateCachePath(): string {
  const Z = getZotero();
  const dir = Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
  return `${dir}/${CACHE_FILE}`;
}

async function readCache(): Promise<CacheState> {
  try {
    const raw = await getZotero().File.getContentsAsync(translateCachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { entries: {} };
    const entries = (parsed as { entries?: Record<string, unknown> }).entries;
    if (!entries || typeof entries !== 'object') return { entries: {} };
    const out: Record<string, CacheEntry> = {};
    for (const [k, v] of Object.entries(entries)) {
      if (!v || typeof v !== 'object') continue;
      const e = v as Partial<CacheEntry>;
      if (typeof e.text === 'string' && typeof e.model === 'string' && typeof e.createdAt === 'number') {
        out[k] = { text: e.text, model: e.model, createdAt: e.createdAt };
      }
    }
    return { entries: out };
  } catch {
    return { entries: {} };
  }
}

async function writeCache(state: CacheState): Promise<void> {
  const entries = Object.entries(state.entries);
  let trimmed = state;
  if (entries.length > MAX_CACHE_ENTRIES) {
    entries.sort(([, a], [, b]) => b.createdAt - a.createdAt);
    const out: Record<string, CacheEntry> = {};
    for (const [k, v] of entries.slice(0, MAX_CACHE_ENTRIES)) out[k] = v;
    trimmed = { entries: out };
  }
  await getZotero().File.putContentsAsync(translateCachePath(), JSON.stringify(trimmed));
}

export async function getCachedTranslation(key: string): Promise<CacheEntry | undefined> {
  const state = await readCache();
  return state.entries[key];
}

// Writes are serialized via writeQueue — same pattern as chat-history.ts.
export function setCachedTranslation(key: string, entry: CacheEntry): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const state = await readCache();
    state.entries[key] = entry;
    await writeCache(state);
  });
  return writeQueue;
}
