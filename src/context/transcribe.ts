import type { Message } from "../providers/types";
import type { ModelPreset } from "../settings/types";
import { getProvider } from "../providers/factory";

export interface TranscribeFigure {
  id: string;          // matches the figure file stem, e.g. "eq-p6-1"
  pngDataUrl: string;  // "data:image/png;base64,..."
}

const SYSTEM_PROMPT =
  "You transcribe cropped images of scientific-paper regions. Each image is " +
  "tagged with an id. Output ONLY a JSON object mapping every id to a faithful " +
  "transcription: LaTeX (no $ delimiters) for a formula, a GitHub-flavored " +
  "markdown table for a table, plain text for a text block. Do not add commentary.";

// Pure: extract the id->transcription map from model output.
export function parseTranscriptionResponse(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return result;
  try {
    const obj: unknown = JSON.parse(body.slice(start, end + 1));
    if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof value === "string") result.set(key, value);
      }
    }
  } catch {
    // unparseable -> empty map; caller treats every figure as un-transcribed
  }
  return result;
}

// Build-time utility call. Returns id->transcription; missing ids = failed.
export async function transcribeFigures(
  figures: TranscribeFigure[],
  preset: ModelPreset,
  signal: AbortSignal,
  onTrace?: (msg: string) => void,
): Promise<Map<string, string>> {
  if (!figures.length) return new Map();
  const message: Message = {
    role: "user",
    content:
      "Transcribe each tagged image. ids: " +
      figures.map((f) => f.id).join(", "),
    images: figures.map((f) => ({
      id: f.id,
      marker: `[id=${f.id}]`,
      name: `${f.id}.png`,
      mediaType: "image/png",
      dataUrl: f.pngDataUrl,
      size: f.pngDataUrl.length,
    })),
  };
  let text = "";
  try {
    for await (const chunk of getProvider(preset).stream(
      [message],
      SYSTEM_PROMPT,
      preset,
      signal,
    )) {
      if (chunk.type === "text_delta") text += chunk.text;
      if (chunk.type === "error") {
        onTrace?.(`stream error: ${chunk.message}`);
        return new Map();
      }
    }
  } catch (e) {
    onTrace?.(`stream threw: ${String(e)}`);
    return new Map();
  }
  onTrace?.(
    `response ${text.length} chars head=${JSON.stringify(text.slice(0, 240))}`,
  );
  const parsed = parseTranscriptionResponse(text);
  onTrace?.(`parsed ${parsed.size} entries`);
  return parsed;
}
