import type { Widget } from "../domain";

export type WidgetPreviewSource = Pick<Widget, "id" | "name" | "icon" | "description" | "supportedSizes" | "states">;

const PREVIEW_WIDTH = 900;
const PREVIEW_HEIGHT = 1200;
const SURFACE_X = 52;
const SURFACE_Y = 52;
const SURFACE_WIDTH = PREVIEW_WIDTH - SURFACE_X * 2;
const SURFACE_HEIGHT = PREVIEW_HEIGHT - SURFACE_Y * 2;

function escapeSVG(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function approximateCharacterWidth(character: string, fontSize: number): number {
  if (character === " ") return fontSize * 0.28;
  if ("ilI.,:;!'|".includes(character)) return fontSize * 0.28;
  if ("mwMW@#%&".includes(character)) return fontSize * 0.86;
  return fontSize * 0.56;
}

function approximateTextWidth(value: string, fontSize: number): number {
  return [...value].reduce((width, character) => width + approximateCharacterWidth(character, fontSize), 0);
}

function splitLongWord(word: string, maxWidth: number, fontSize: number): string[] {
  if (approximateTextWidth(word, fontSize) <= maxWidth) return [word];
  const chunks: string[] = [];
  let chunk = "";
  for (const character of [...word]) {
    const candidate = `${chunk}${character}`;
    if (chunk && approximateTextWidth(candidate, fontSize) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(value: string, maxWidth: number, fontSize: number, maxLines: number): readonly string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["No public description."];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    for (const segment of splitLongWord(word, maxWidth, fontSize)) {
      const candidate = current ? `${current} ${segment}` : segment;
      if (current && approximateTextWidth(candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = segment;
      } else {
        current = candidate;
      }
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const last = visible[maxLines - 1] ?? "";
  visible[maxLines - 1] = `${last.replace(/[.\s]+$/, "")}…`;
  return visible;
}

function renderTextLines(lines: readonly string[], x: number, y: number, fontSize: number, lineHeight: number, className: string): string {
  return `<text class="${className}" x="${x}" y="${y}" font-size="${fontSize}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeSVG(line)}</tspan>`).join("")}</text>`;
}

function renderSizeChips(sizes: readonly string[]): string {
  const visibleSizes = [...new Set(sizes.map((size) => size.trim()).filter(Boolean))].slice(0, 4);
  if (visibleSizes.length === 0) return "";
  return visibleSizes.map((size, index) => {
    const x = 96 + index * 138;
    return `<g><rect x="${x}" y="850" width="122" height="42" rx="21" fill="#f0f0f3" stroke="#d9d9df"/><text x="${x + 61}" y="877" text-anchor="middle" font-size="16" font-weight="700" fill="#4d4f58">${escapeSVG(size)}</text></g>`;
  }).join("");
}

export function renderWidgetPreviewSVG(widget: WidgetPreviewSource): string {
  const hasEmptyState = widget.states.some((state) => state.trim().toLowerCase() === "empty");
  const stateLabel = hasEmptyState ? "Empty state" : "Public preview";
  const stateHeading = hasEmptyState ? "Nothing here yet" : "Preview available";
  const icon = widget.icon.trim().slice(0, 2).toUpperCase() || "W";
  const descriptionLines = wrapText(widget.description, 660, 26, 4);
  const headingLines = wrapText(stateHeading, 660, 42, 2);
  const nameLines = wrapText(widget.name, 520, 30, 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}" role="img" aria-labelledby="preview-title preview-description">
  <title id="preview-title">${escapeSVG(widget.name)} server-rendered preview</title>
  <desc id="preview-description">${escapeSVG(widget.description || "Public widget preview")}</desc>
  <rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="#f4f4f6"/>
  <rect x="${SURFACE_X}" y="${SURFACE_Y}" width="${SURFACE_WIDTH}" height="${SURFACE_HEIGHT}" rx="42" fill="#ffffff" stroke="#d9d9df" stroke-width="2"/>
  <text x="96" y="118" font-size="16" font-weight="800" letter-spacing="2.2" fill="#747680">SERVER-RENDERED PREVIEW</text>
  <circle cx="132" cy="214" r="48" fill="#111214"/>
  <text x="132" y="225" text-anchor="middle" font-size="22" font-weight="800" letter-spacing="-1" fill="#ffffff">${escapeSVG(icon)}</text>
  ${renderTextLines(nameLines, 208, 207, 30, 38, "widget-name")}
  <text x="208" y="284" font-size="17" fill="#747680">Public widget metadata</text>
  <line x1="96" y1="342" x2="804" y2="342" stroke="#e2e2e7"/>
  <text x="96" y="410" font-size="18" font-weight="800" letter-spacing="1.4" fill="#747680">${escapeSVG(stateLabel.toUpperCase())}</text>
  ${renderTextLines(headingLines, 96, 492, 42, 50, "state-heading")}
  ${renderTextLines(descriptionLines, 96, 644, 26, 39, "widget-description")}
  ${renderSizeChips(widget.supportedSizes)}
  <text x="96" y="1030" font-size="17" fill="#747680">No runtime or package content is executed in this preview.</text>
  <text x="96" y="1080" font-size="15" fill="#9a9ba3">${escapeSVG(stateLabel)} · Public catalog illustration</text>
</svg>`;
}
