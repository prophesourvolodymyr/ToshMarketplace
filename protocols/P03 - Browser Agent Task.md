# BRW-01: Browser Agent Prompt Protocol

**System ID:** `BRW-01`
**Trigger:** AI agent needs tokens, auth codes, or any info from a website that requires human-like browser interaction (login, clicking, searching).
**Output Target:** `/junk/browser-agent-prompt.md`

---

## PHASE 1: DETECT & SUGGEST

**When AI realizes it needs browser-based info** (token from Instagram, auth cookie from a dashboard, data behind a login wall, etc.), the AI does NOT immediately ask the user to do it manually.

Instead, AI tells the user:

> "I need [what info] from [what site]. This requires [logging in / clicking through / searching]. Instead of you doing this manually, I can generate a prompt for the browser agent to handle it. Want me to?"

This gives the user a choice:
- **User says yes** → AI proceeds to Phase 2.
- **User says no / wants to do it manually** → AI gives exact steps for the user.

---

## PHASE 2: GENERATE PROMPT

AI creates a single, concise, actionable prompt saved to `/junk/browser-agent-prompt.md`.

**Rules for the prompt:**

1. **One prompt covers everything** — all URLs, all tasks, all info to extract.
2. **Be specific about what kind of site** — actual URLs may differ, but describe the site type clearly (e.g., "Instagram's settings page", "the admin dashboard at dashboard.example.com").
3. **Describe every action the browser agent needs to take:**
   - Navigate to URL
   - Click specific buttons ("click the Login button top-right")
   - Fill forms ("enter username in the first field")
   - Search for things ("search for 'API token' in the page")
   - Extract specific data ("copy the value next to 'Access Token'")
   - Handle login walls ("if redirected to login, use the credentials provided below")
4. **Specify exactly what to bring back** — token value, cookie string, response JSON, screenshot confirmation, etc.
5. **Include credentials if needed** — API keys, login details the AI already has. (Never store these in the prompt permanently — the prompt is in `/junk` and disposable.)

**Template:**

```markdown
## Browser Agent Task

**Goal:** [One sentence — what info to extract and why]

### Sites to Visit

#### Task 1: [Name]
- URL: [exact URL or description of where to find it]
- Steps:
  1. [Navigate to...]
  2. [Click...]
  3. [Fill...]
  4. [Extract...]
- **Bring back:** [Exactly what data]

#### Task 2: [Name]
- ...

### Credentials (if needed)
- Username: [if known]
- Password: [if known]
- 2FA: [user will need to handle this manually / use backup code]

### Expected Output
- [List every piece of data to return, with format]
```

---

## EXECUTION CONSTRAINTS

1. **ALWAYS SUGGEST FIRST** — Never default to asking the user to do browser tasks. Offer the browser agent prompt option every time.
2. **ONE PROMPT** — Don't split into multiple files. One prompt per session/feature.
3. **DISPOSABLE** — Prompt goes to `/junk/`, can be deleted after use.
4. **USER CONFIRMS** — If credentials are included, user must approve before the prompt is used.
5. **PLAIN LANGUAGE** — The browser agent is an AI too, so be clear and direct in instructions.

---

## COMPLETION CRITERIA

- The AI suggests a browser-agent prompt instead of asking the user to perform manual browser work
- The user approves generating the prompt
- The prompt is saved to `/junk/browser-agent-prompt.md`
- One prompt covers all URLs and tasks for the session
- The prompt clearly states the information to return
