# Skills

`meridian/SKILL.md` is a guide book for an AI agent that has the Meridian MCP
server connected. It is written for the model, not for a person: what to call
first, what each tool takes, and the handful of rules that decide whether a
change lands correctly or produces a plan the couple never agreed to.

It exists because the tool descriptions alone cannot carry everything. A
description says what one tool does; it cannot say *"read the journey before you
suggest anything"*, or *"count the nights out loud before writing a check-out
date"*, or *"lead with what the other person did, because the user was there for
their own edits."* Those are the things that make the difference between an
assistant that can technically call the tools and one that is useful over
breakfast.

## Installing it

**Claude Code** — copy it to either place:

```bash
mkdir -p ~/.claude/skills/meridian          # available everywhere
cp skills/meridian/SKILL.md ~/.claude/skills/meridian/

mkdir -p .claude/skills/meridian            # or just this project
cp skills/meridian/SKILL.md .claude/skills/meridian/
```

**Claude Desktop / claude.ai** — upload `SKILL.md` as a skill, or paste it as a
project instruction.

**Anything else that takes a system prompt** — paste the file. It is
self-contained by design; there are no companion files to load.

The skill is loaded on its description, so it activates on "my trip", "the
itinerary", "who owes what", "what did she add" and similar without being asked
for by name.

## Keeping it true

The tool tables in it are generated from `src/mcp/registry.ts` by hand. When a
tool's name, arguments or module changes, the skill is wrong until it is
updated — and a wrong skill is worse than none, because the model will trust it
over the tool list it was actually given. Treat it as part of the MCP surface,
not as documentation about it.
