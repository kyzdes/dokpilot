<!-- managed by context-map skill: BEGIN agent-rule -->
## Project Context Map

- Before planning or editing, read `context-map-vps-ninja/context-map.md` and the split files it links to (`known-issues.md`, `decisions.md`, `tasks.md`, `gotchas.md`; `architecture.md` if present).
- Treat `Known Issues`, `Decisions`, and the `Agent Conflict Protocol` section as project memory.
- If a requested change conflicts with a Known Issue or Decision, explain the conflict and ask the user before proceeding.
- Update the context map when entry points, architecture, deploy flow, run/test commands, DB schema, auth, payments, or external integrations change; when a significant decision is made or reversed; when a known issue is discovered, fixed, or accepted; when a fix prevents a future regression.
- Do not put secrets, tokens, passwords, or private credentials in the context map.
- Never commit `context-map-vps-ninja/` content. The skill ensures `.gitignore` excludes it; if you find this folder being staged, remove it from the index and verify the project's `.gitignore` carries the rule.
<!-- managed by context-map skill: END agent-rule -->
