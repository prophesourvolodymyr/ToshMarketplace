# AUD-01: Feature Audit Protocol

**System ID:** `AUD-01`
**Trigger:** User says "audit FXX", "audit [feature name]", "research [feature]", "tell me what I'm missing on [feature]", or any variant asking for a feature deep-dive.
**Input Requirement:** A feature with any amount of existing docs — can be a full `DOCKS.md`, a raw note in `genesis/`, a sketch in `notes/`, or just a verbal description.
**Output:** AI delivers the audit directly in chat. Optionally saved to `features/FXX-name/FXX-AUDIT.md` if user wants.

---

## PHASE 1: READ & UNDERSTAND

**Goal:** Absorb everything we already know about this feature.

### 1.1 Find Every Source
Read everything that mentions this feature, wherever it lives:
- `features/FXX-name/DOCKS.md` (if it exists)
- `features/DOCKS.md` (the index — what does it say about this feature?)
- `genesis/ORIGINAL IDEA.md` (the project's origin)
- `genesis/REFERENCE/` (any linked research)
- `STYLES.md` (design conventions if relevant)
- `CYCLES.md` (where does this feature sit in the order? what depends on it?)
- Any dependency DOCKS.md files (features this one depends on)
- Any raw notes the user has mentioned

### 1.2 Confirm Scope
Write a 2-4 line summary of what you think the feature is. Present to user:
> "As I understand it, this feature is about [summary]. It depends on [FXX, FYY]. Its deliverables are [list]. Correct?"

User confirms or corrects. Don't move forward until aligned.

---

## PHASE 2: RESEARCH & INTERROGATE

**Goal:** Find everything we DON'T know. Fill gaps. Challenge assumptions. Discover better ways.

This phase has no fixed duration. It can be 30 seconds or 30 iterations. Go as deep as the feature needs.

### 2.1 Gap Analysis (Internal)
Read the feature docs again. Ask yourself:
- What did the user forget to mention?
- What happens when this fails? What are the edge cases?
- What's the fallback if the backend is down / file is missing / user is offline?
- Does this contradict anything in dependencies or STYLES.md?
- Is the user describing one feature or accidentally describing three?
- What sub-systems are hiding inside this feature?

### 2.2 Ask the User (Sharp Questions)
Formulate focused questions to close gaps. Rules:
- **Plain English.** The user is not a developer. Never ask a question that requires knowing code internals.
- **Challenge assumptions.** "You said X — but what if Y happens during X?"
- **Start with impact.** "The risk here is [what it means for the feature]. How should we handle it?"
- **Unlimited count.** Ask as many or as few as the feature needs. A well-documented feature may need zero questions. A vague one-sentence idea may need 15.

Format each question:
> **QN: [Question]**
> - **Why I'm asking:** [Context — what gap this fills]
> - **Impact:** [What changes depending on the answer]
>
> Your response: _

### 2.3 External Research
Search the internet. Find:
- Open source repos implementing similar features
- Competitor apps that do this well
- Technical blog posts about the approach
- Libraries or frameworks that solve part of the problem
- Prior art — has someone already built this?

**If research reveals the implementation is non-trivial:** suggest triggering the Reverse Engineering Protocol (REV-01).
> "The way [App X] implements [feature] is complex — encrypted payloads, custom protocol. This might need reverse engineering. Want me to trigger REV-01 to figure out how they do it?"

### 2.4 AI-Generated Ideas
Propose improvements the user didn't ask for. Could be 2, could be 8. Each one:
- **Title** — what to add/change
- **Why** — what problem it solves or experience it improves
- **Complexity** — Low / Medium / High
- **User response spot** — [ ] Yes / [ ] No / [ ] Modify

Examples of what to suggest:
- Polish (animations, haptics, transitions)
- Edge case handling (empty states, error states, loading states)
- Delight (smart defaults, shortcuts, small surprises)
- Robustness (retry logic, offline support, data validation)
- Architecture (if a different approach would be cleaner)

### 2.5 Problems & Risks
Flag anything that could block or complicate the feature:
- **Problem** (plain English — what it means for the user, not the code)
- **Why it matters** (impact on timeline, scope, or UX)
- **Suggested fix** (what you'd do about it)
- **Complexity** — Low / Medium / High

### 2.6 Iterate (As Many Rounds As Needed)
After presenting findings, user may:
- Answer questions → update audit
- Ask more questions → dig deeper
- Trigger REV-01 → reverse engineer something
- Trigger BRW-01 → get browser agent to extract tokens/info
- Ask for more ideas → brainstorm further

**This phase loops until user says "enough" or "approved."**

---

## PHASE 3: DELIVER THE AUDIT

**Output directly in chat.** Structured but freeform. User reads it, sizes it up, decides what to act on.

### Template

```markdown
# Audit — FXX — [Feature Name]
**Date:** [today]
**Sources reviewed:** [list of every doc read in Phase 1]

---

## Summary
[2-4 line recap of what this feature is and what we're building]

---

## Questions
*[Skip this section if nothing is unclear]*

**Q1: [Question]**
- Why: [context]
- Impact: [what changes]
- Your response: _

**Q2: [Question]**
- Your response: _

---

## Research
*[Skip if no external research was needed]*

- **[Source/Tool/Repo]:** [What was found and why it matters]
- **Reverse Engineering needed?** [Yes — REV-01 suggested / No / Done — findings linked]

---

## Ideas & Suggestions
*[Optional enhancements]*

1. **[Idea title]**
   - What: [description]
   - Why: [benefit]
   - Complexity: Low / Medium / High
   - User decision: Yes / No / Modify

2. **[Idea title]**
   - ...

---

## Problems & Risks
*[Skip if nothing found]*

- **Problem:** [What this means for the feature]
  - Impact: [What gets blocked or complicated]
  - Fix: [How to handle it]
  - Complexity: Low / Medium / High

---

## Other Notes
*[Anything that doesn't fit above]*

Your response: _
```

---

## EXECUTION CONSTRAINTS

1. **PLAIN ENGLISH ALWAYS.** Every finding must be understandable by someone who doesn't code. Lead with impact, not mechanism. If you must mention technical details, put them in a collapsed note: `🔧 Technical detail (optional)`.

2. **NO CODE IN AUDITS.** This is a conversation document. No code snippets, no file paths, no function names in the main body.

3. **FREEDOM OF DEPTH.** A tiny feature gets a tiny audit. A massive feature gets a massive audit. No minimum or maximum.

4. **AI INITIATIVES.** Proactively suggest other protocols (REV-01, BRW-01) and explain the visual-planning option when the situation calls for it. Don't wait for the user to remember they exist.

5. **ITERATE UNTIL SOLID.** Phase 2 can loop. User asks more questions → AI researches more → tighter audit. Stop only when user approves.

6. **SAVE OPTIONAL.** By default, deliver the audit in chat. Save to `features/FXX-name/FXX-AUDIT.md` only if user asks.

7. **SOURCE AGNOSTIC.** The feature's docs can live anywhere — `features/`, `genesis/`, `notes/`, raw user messages. Read them all.

---

## COMPLETION CRITERIA

- All existing docs for the feature are read and understood
- Scope is confirmed with the user
- Gaps are identified and questioned
- External research is performed when applicable
- AI-generated ideas are proposed
- Problems and risks are flagged
- The audit is delivered in chat
- The user approves, or Phase 2 loops until the audit is satisfactory
