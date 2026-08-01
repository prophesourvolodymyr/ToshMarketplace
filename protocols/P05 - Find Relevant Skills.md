# SKL-01: Find Skills Protocol

**System ID:** `SKL-01`
**Trigger:** User says "find a skill for [task]", "is there a skill for [X]", "what skills exist for [domain]", or "document this with a skill."
**Input Requirement:** The task or domain the user needs a skill for.
**Output:** AI presents verified skill recommendations with install commands. Optionally installs them.

---

## PHASE 1: DEFINE THE NEED

**Goal:** Narrow down exactly what kind of skill the user needs.

Ask yourself (internally):
- **Domain:** What area? (React, testing, deployment, design, n8n, iOS, etc.)
- **Task:** What specific job? (write tests, create animations, review PRs, reverse engineer, deploy)
- **Gap:** Is this something the user does often? Is a reusable skill better than a one-off prompt?

If the domain or task is unclear, ask the user one clarifying question:
> "Are you looking for a skill for [interpretation], or something more like [alternative]?"

Otherwise, proceed directly to search.

---

## PHASE 2: SEARCH

**Goal:** Find relevant skills. Check the leaderboard first, then run CLI searches.

### 2.1 Check the Leaderboard
Browse https://skills.sh/ for the top skills in the relevant domain. Priority: well-known sources like `vercel-labs/agent-skills`, `anthropics/skills`, `ComposioHQ/awesome-claude-skills`.

### 2.2 Run CLI Search
```bash
npx skills find "<keyword1> <keyword2>"
```
Use specific keywords. Examples:
- "react performance" not "react"
- "pr review" not "review"
- "changelog generation" not "docs"

Try alternative terms if the first search yields nothing:
- "deploy" → also try "deployment", "ci-cd", "release"
- "iOS" → also try "swift", "xcode", "mobile"

### 2.3 When Nothing Is Found
If no relevant skills exist:
- Tell the user plainly: no match found
- Offer to help with the task directly using general capabilities
- Mention they can create their own: `npx skills init my-skill-name`
- **Do NOT recommend a skill that doesn't match** just to have a result

---

## PHASE 3: VERIFY QUALITY

**Goal:** Never recommend a skill blindly. Verify before presenting.

For each candidate, check:

| Check | Threshold | Why |
|---|---|---|
| **Installs** | Prefer 1K+. Be skeptical under 100. | Battle-tested |
| **Source** | Official (vercel-labs, anthropics, microsoft, etc.) > known community > unknown | Trust |
| **GitHub stars** | Prefer 100+. Skeptical under 20. | Community validation |
| **Description match** | Does it actually do what the user needs? | Relevance |

**If a skill fails these checks:** mention it with a warning. Let the user decide.
> "I found `unknown-dev/sketchy-skill` (12 installs, 3 stars). This exists but has very low adoption. I'd be cautious. The closest well-vetted alternative is..."

---

## PHASE 4: PRESENT & INSTALL

**Goal:** Show the user what was found, let them choose, install if approved.

### 4.1 Present
For each recommended skill:

> **`skill-name`** — [One-line description of what it does]
> Source: `owner/repo` | Installs: XXX | Stars: XXX
>
> Install: `npx skills add owner/repo@skill-name`
> Learn more: https://skills.sh/owner/repo/skill-name

If multiple good matches, present all and ask which one:
> "Found 3 skills. `A` is the most popular, `B` is more specialized for your use case, `C` is lightweight. Which one?"

### 4.2 Install
When user picks one:
```bash
npx skills add <owner/repo@skill> -g -y
```
- `-g` = global install
- `-y` = skip confirmation prompts

### 4.3 Document
If this skill was found FOR a specific feature (e.g., "find a skill for F03's animation system"), note it in the feature's audit or DOCKS.md:
> "Recommended skill: `animation-skill` — handles spring-based animations. Installed [date]."

---

## EXECUTION CONSTRAINTS

1. **ONLY WHEN ASKED.** Don't proactively search for skills. Wait for user to trigger this protocol.
2. **VERIFY FIRST.** Never recommend without checking installs, source, and stars.
3. **PREFER BATTLE-TESTED.** A popular skill from a known source beats a niche skill from an unknown author.
4. **HONEST ABOUT NOTHING FOUND.** Better to say "no skill exists" than to recommend junk.
5. **ONE DECISION AT A TIME.** Present findings, wait for user to pick, then install.

---

## COMPLETION CRITERIA

- The domain and task are clarified
- The leaderboard is checked and the CLI search runs
- Quality is verified through installs, source, and stars
- Recommendations are presented to the user
- The chosen skill is installed when the user approves
- Relevant feature docs reference the skill when applicable
