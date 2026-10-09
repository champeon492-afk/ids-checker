// Project MMI labels and colours follow Table 1 of the supplied MMI reference.
export const MMI_LEVELS = [
  ["0", "Early phase", "#D73296"],
  ["100", "Basic information", "#BE2823"],
  ["125", "Established concept", "#D24B46"],
  ["150", "Interdisciplinary controlled concept", "#E17873"],
  ["175", "Chosen concept", "#F0AAAA"],
  ["200", "Finished concept", "#E69637"],
  ["225", "Established solutions in principle", "#EBAF64"],
  ["250", "Interdisciplinary controlled principal solutions", "#F0C88C"],
  ["275", "Chosen solutions of principle", "#F5E6D7"],
  ["300", "Basis for detailing", "#FAF050"],
  ["325", "Established detailed solutions", "#D7CD41"],
  ["350", "Interdisciplinary controlled detailed solutions", "#B9AF3C"],
  ["375", "Detailed solutions for tendering or ordering", "#9B9632"],
  ["400", "Basis for work", "#378246"],
  ["425", "Established or executed", "#4BAA5A"],
  ["450", "Controlled execution", "#64C37D"],
  ["475", "Approved execution", "#9BD7A5"],
  ["500", "As built", "#1E46AF"],
  ["600", "In operation", "#9B00CD"],
].map(([key, name, color]) => ({ key, name, color, group: Number(key) % 100 === 0 ? "Primary" : `Secondary · ${Math.floor(Number(key) / 100) * 100} series` }));

export const MMI_EXTRA = [
  { key: "missing", name: "MMI not assigned", color: "#aab5ab", group: "Needs input" },
  { key: "invalid", name: "Unrecognized value", color: "#f47a79", group: "Needs review" },
];

export const MMI_BY_KEY = new Map([...MMI_LEVELS, ...MMI_EXTRA].map((level) => [level.key, level]));

export function defaultMmiSource(rows) {
  const counts = new Map();
  for (const row of rows) for (const source of Object.keys(row.statusSources || {})) counts.set(source, (counts.get(source) || 0) + 1);
  if (counts.has("NONS_Process")) return "NONS_Process";
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "NONS_Process";
}

export function classifyMmi(row, source) {
  if (!row.propertySets?.includes(source)) return { key: "missing", reason: "Property set missing", raw: "" };
  if (!Object.prototype.hasOwnProperty.call(row.statusSources || {}, source)) return { key: "missing", reason: "ProcessStatus property missing", raw: "" };
  const value = row.statusSources[source];
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return { key: "missing", reason: "ProcessStatus value blank", raw: "" };
  const match = /^(?:MMI\s*)?(\d{1,3})(?:\.0+)?$/i.exec(raw);
  const key = match?.[1];
  if (key && MMI_BY_KEY.has(key)) return { key, reason: "", raw };
  return { key: "invalid", reason: `Value “${raw}” is not a defined MMI level`, raw };
}
