export const MANAGED_INSTRUCTIONS_START = "<!-- framework-collaboration-harness:start -->";
export const MANAGED_INSTRUCTIONS_END = "<!-- framework-collaboration-harness:end -->";

export function mergeManagedInstructions(existing = "", instructions) {
  const block = `${MANAGED_INSTRUCTIONS_START}\n${instructions.trim()}\n${MANAGED_INSTRUCTIONS_END}\n`;
  const start = existing.indexOf(MANAGED_INSTRUCTIONS_START);
  const end = existing.indexOf(MANAGED_INSTRUCTIONS_END, start);

  if (start >= 0 && end >= start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + MANAGED_INSTRUCTIONS_END.length).replace(/^\n?/, "")}`;
  }

  return existing.length === 0 ? block : `${existing.replace(/\s*$/, "")}\n\n${block}`;
}
