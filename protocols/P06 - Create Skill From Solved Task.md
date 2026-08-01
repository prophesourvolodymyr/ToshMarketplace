# SKL-02: Create Skill From Task Protocol

**System ID:** `SKL-02`
**Trigger:** User says "turn this into a skill", "save this as a skill", "create a skill from this", or "make a skill for what we just did."
**Input Requirement:** A recently completed task or solution that the user wants to reuse.
**Output Target:** `/skills/skill-name.md` — a reusable skill file.

---

## PHASE 1: IDENTIFY WHAT TO CAPTURE

**Goal:** Decide if the solved task is worth turning into a skill.

### 1.1 Is This Skill-Worthy?
Ask yourself:
- Will this task come up again? (If it's a one-off, skip — don't create clutter)
- Is the solution non-obvious? (If anyone could figure it out in 2 minutes, skip)
- Does it involve specific steps, commands, or knowledge? (If yes — good candidate)
- Did the user struggle or need help? (If yes — strong candidate)

If the answer to at least 2 is YES, proceed.

If NO: tell the user it's probably not worth a skill and why.

### 1.2 Scope the Skill
Before writing, clarify with user:
> "This skill would cover: [summary of what it does]. When triggered, the AI would [key behaviors]. Does that sound right?"

User confirms or adjusts scope.

---

## PHASE 2: EXTRACT THE SOLUTION

**Goal:** Document exactly how the task was solved. Capture the pattern, not just the output.

### 2.1 Break Down What Happened
Walk through the recent work. Identify:

- **Trigger:** What made us do this? What user request or situation?
- **Input:** What did we start with? What files, data, constraints?
- **Process:** What steps did we take? In what order?
- **Tools used:** What commands, APIs, libraries, or techniques?
- **Decisions made:** What choices mattered? What alternatives did we reject?
- **Output:** What did we produce? Where did it go?
- **Gotchas:** What went wrong? What did we learn the hard way?

### 2.2 Write the Plain English Version
Summarize the solution in 2–4 sentences — as if explaining to someone who wasn't there.
> "When the user wants [X], the AI reads [A], searches [B], then generates [C] using [method]. The tricky part is [D] — we handle it by [E]."

---

## PHASE 3: CREATE THE SKILL FILE

**Goal:** Write the skill to `/skills/skill-name.md`.

### 3.1 Ensure the Directory Exists
```bash
mkdir -p skills/
```

### 3.2 Name the Skill
Use lowercase, hyphens, descriptive:
- `reverse-engineer-ios-app.md`
- `audit-feature-for-gaps.md`
- `generate-html-mockup.md`

### 3.3 Skill File Template

```markdown
# Skill: [Skill Name]

**Source task:** [Brief reminder of what we were doing when this skill emerged]
**Date created:** [Today]

---

## When to Use
- [Situation 1 — when the user asks X]
- [Situation 2 — when Y condition is met]
- [Situation 3]

## What the AI Does

### Step 1: [Phase name]
[What happens. What the AI reads, checks, or asks.]

### Step 2: [Phase name]
[What happens. Commands to run, searches to perform, files to create.]

### Step 3: [Phase name]
[What happens. What to output, where to save, what to verify.]

## Key Rules
- [Rule 1]
- [Rule 2]
- [Rule 3]

## Commands Reference
```bash
# [What this does]
command --flag value

# [What this does]
another-command arg1 arg2
```

## Gotchas & Lessons Learned
- [Thing that went wrong and how to avoid it]
- [Edge case that matters]
- [Assumption that turned out false]

## Example
**User says:** "[Example trigger]"

**AI does:**
1. [Step]
2. [Step]
3. [Output]

---

**Related skills:** [If any other skills connect to this one]
```

---

## PHASE 4: REGISTER THE SKILL

### 4.1 Confirm with User
Present the completed skill file. Let the user read and approve.
> "Created `/skills/skill-name.md`. It covers [summary]. Want any changes?"

### 4.2 Link It (If Applicable)
If this skill relates to a specific feature, note it in the feature's DOCKS.md or AUDIT.md:
> "Reusable skill created: `skills/reverse-engineer-ios-app.md`"

---

## EXECUTION CONSTRAINTS

1. **DON'T OVER-CREATE.** Not every task needs a skill. Only when the solution is reusable, non-obvious, and likely to come up again.
2. **CAPTURE THE WHY.** A skill without the reasoning behind decisions is useless. Explain why things were done a certain way.
3. **PLAIN ENGLISH.** The skill file should be readable by someone who wasn't in the room when the task was solved.
4. **KEEP IT NARROW.** One skill = one task pattern. Don't cram multiple unrelated solutions into one file.
5. **INCLUDE GOTCHAS.** The hard-learned lessons are the most valuable part of a skill.

---

## COMPLETION CRITERIA

- The task is confirmed as skill-worthy
- Scope is confirmed with the user
- The `/skills/` directory exists
- A skill file covers its name, steps, rules, gotchas, and example
- The user reviews and approves it
- Relevant feature docs reference the skill when applicable
