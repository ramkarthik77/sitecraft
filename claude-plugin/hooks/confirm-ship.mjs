#!/usr/bin/env node
// PreToolUse hook: always ask the person before a merge or publish runs,
// even when the server is configured to let agents ship.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    /* no input */
  }
  const tool = String(input.tool_name ?? "");
  const args = input.tool_input ?? {};
  const what = tool.endsWith("publish_site")
    ? `publish site "${args.site}" to its live URL`
    : `merge branch "${args.branch}" into main on site "${args.site}"`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `Claude wants to ${what}. Approve only if you've reviewed the preview.`,
      },
    }),
  );
});
