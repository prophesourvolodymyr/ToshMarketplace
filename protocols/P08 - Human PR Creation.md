# P08: Human PR Creation Protocol

**System ID:** `PR-01`
**Trigger:** User says "make a PR", "submit this", "send these changes", "create pull request"

---

## PHASE 0: Review Changes First

**Before writing anything**, AI reviews the diff to understand what actually changed.

```bash
git diff --stat           # which files, how many lines
git diff                  # the actual changes
```

AI reads through the changes and notes:
- What was added, removed, changed — in plain terms
- Any complex or non-obvious lines that might confuse a reviewer
- Any decisions that aren't visible from the code alone ("why did we pick this approach?")
- Any side effects ("this also touches the config file because...")

This review is internal — AI uses it to write the PR message, not to generate a separate review doc. The goal: AI actually understands the diff before writing about it.

---

## PHASE 1: Route Selection

AI checks the situation and picks the right route:

| Situation | Route |
|---|---|
| You own the repo, working directly on it | Just push and `gh pr create` |
| You cloned someone's repo, already made changes | Fork → add remote → push → PR (no recopying) |
| Starting fresh on someone's repo | `gh repo fork owner/repo --clone` → branch → work → PR |
| You don't have `gh` logged in | Generate the PR message, user submits via browser |

### Route 1: You Own the Repo
```bash
git push origin feature-branch
gh pr create --base main --head feature-branch --title "Fix X" --body "..."
```

### Route 2: Cloned Someone's Repo, Already Made Changes
```bash
gh repo fork owner/repo --remote=false
git remote add myfork https://github.com/prophesourvolodymyr/repo.git
git push myfork feature-branch
gh pr create --repo owner/repo --base main --head prophesourvolodymyr:feature-branch --title "Fix X" --body "..."
```

### Route 3: Starting Fresh
```bash
gh repo fork owner/repo --clone
cd repo
git checkout -b feature-branch
# ... make changes ...
git push -u origin feature-branch
gh pr create --base main --title "Fix X"
```

### Route 4: No `gh` Auth
Generate the PR message, then tell user:
> "Run this from the repo: `gh pr create --base main --title '...' --body '...'`"

---

## PHASE 2: Message Writing Style

**Rules for the PR message:**

- **B2 English.** Short sentences. No complex grammar. Drop some commas. Skip filler words. Like someone who speaks English as a second language but gets the point across.
- **No AI voice.** Avoid: "This PR implements...", "We have enhanced...", "Additionally...", "Furthermore...", "Moreover...". Nobody talks like that. Cut them all.
- **Use natural starts:** "Fixed...", "Added...", "Changed...", "Now it does...", "Before it would...", "Removed...", "Moved..."
- **No fluff words.** Cut: "comprehensive", "robust", "optimized", "streamlined", "leverage". Say what actually happened.

**Good vs bad:**
```
❌ "This pull request implements a comprehensive refactoring of the authentication
    middleware, enhancing error handling and improving user experience through
    optimized validation flows."

✅ "Fixed the login bug where empty password would crash. Added validation for email
    format. Now shows proper error messages instead of white screen."
```

---

## PHASE 3: PR Message Template

**AI adapts the format to the changes.** No hardcoded sections. The message tells a story — what was happening, what you did about it, what the result looks like. If it's 2 lines of CSS, the message is 3 sentences. If it's a 15-file refactor, it gets a narrative intro with bullet points. AI decides.

**Structure (flexible):**
```
[Opening paragraph — the story. What was the problem? What was the impact?]
[What you did about it — natural flow, could be sentences or bullets]
[Notes if needed — edge cases, what's left, test evidence. Skip if nothing to add.]
```

**Adaptive rules:**
- **Small fix:** 2–4 sentences. Tell what was wrong, what you changed. No sections, no bullets.
- **New feature:** 1 paragraph telling why this was needed, then bullets of what was done. The story covers the "why" — no separate section.
- **Big refactor:** Longer narrative intro explaining motivation, then grouped bullet points. Notes for migration/breaking changes.
- **Bug fix:** 1–2 sentences about the bug's impact, then what fixed it.

**Example — small fix:**
```
The login page would crash if the user hit enter on an empty password field.
Wasn't catching null before passing to bcrypt. Added a guard in the handler
and a proper error message on the form.
```

**Example — new feature:**
```
People kept asking for a way to find projects without scrolling through 50+
items. So added a search bar to the dashboard header.

- Searches both titles and descriptions, not just titles
- Debounced at 300ms — no typing lag
- Empty state shows placeholder "Search your projects"
- Dropdown closes on click-outside
- Tested up to 2000 items, all queries under 100ms

Tag search not in this PR — that's next.
```

**Example — bug fix:**
```
The /analyze endpoint was returning timeouts for repos over 500 files. The
model sometimes takes 20+ seconds, we were cutting it off at 5.

Bumped timeout to 30s. Added one retry if first call gets 504.
Tested on 3 sizes: 10 files, 500 files (11s), 2200 files (24s).
```

---

### Including Images

If the user wants screenshots or images in the PR, there are two ways:

**Option 1: Commit images to the PR branch (recommended)**
The PR is just a branch. Anything you commit to that branch and push appears in the PR — including images. Reference them with a relative path in the PR description.

```bash
# You're on the branch you're submitting as PR
mkdir -p docs/screenshots
cp ~/Desktop/before-fix.png docs/screenshots/
cp ~/Desktop/after-fix.png docs/screenshots/
git add docs/screenshots/
git commit -m "Add screenshots for PR"
git push          # pushes images + code to the PR branch
```

Then in the PR description:
```markdown
| Before | After |
|---|---|
| ![before](docs/screenshots/before-fix.png) | ![after](docs/screenshots/after-fix.png) |
```

The images become part of the repo permanently. Reviewers see them rendered inline.

**Option 2: Drag into GitHub (no repo files)**
Open the PR URL in browser. Drag the image from Finder directly into the description text box. GitHub uploads and hosts it automatically — no file added to the repo. AI tells user: "Open [PR URL], drag your screenshot into the description box."

---

## PHASE 4: Draft Review (Mockup)

**Before creating the PR**, AI writes the message draft to `/junk/pr-message.md` so the user can review and tweak it.

AI says:
> "Wrote PR draft to `/junk/pr-message.md`. Review it and say 'approved' or 'push it' when ready."

**User can edit the file directly** before approving. AI will use whatever the file contains at submission time.

**Skip this phase if user says:**
- "write PR directly" / "just make it" / "post it" / "submit it" / "push it now"

Any command that implies "go straight to creation" skips the mockup step.

---

## PHASE 5: Create & Submit

1. AI stages and commits any uncommitted changes (unless user says no)
2. AI runs the route command from Phase 1
3. If `gh` is available and authenticated: AI creates the PR directly
4. If `gh` is not available: AI outputs the exact command + PR message for the user to paste
5. AI reports: PR URL and what was submitted

---

## EXECUTION CONSTRAINTS

1. **ADAPT, DON'T HARDCODE.** The message size and structure depends on the changes. 2 lines of CSS does not need 10 bullet points.
2. **B2 ENGLISH.** Short sentences. Dropped commas. No corporate speak. No AI voice.
3. **BULLET POINTS, NOT PARAGRAPHS.** What changed is always scannable, never a wall of text.
4. **HONEST NOTES.** If something is half-done or skipped — say so. Reviewers respect honesty.
5. **ONE PR = ONE PURPOSE.** Don't bundle unrelated fixes. If this PR does multiple things — split it or say why they're together.
6. **TEST EVIDENCE.** If you tested it — put it in Notes. If you didn't — say what still needs testing.
