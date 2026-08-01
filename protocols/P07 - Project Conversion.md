# P07: Project Conversion Protocol

**System ID:** `CNV-01`
**Trigger:** User says "convert this project", "migrate to the new system", "bring this project into the management system", or the AI detects State D (existing codebase with old/missing documentation).
**Input Requirement:** A project directory — can have old documentation, partial docs, or **no documentation at all** (just code).
**Output:** The project fully converted into the AGENTS.md system structure. Nothing deleted. Everything mapped.

---

### HOW THE SCRIPT HELPS

This protocol focuses on **discovering and mapping** content. The actual folder structure creation (AGENTS.md, protocols/, genesis/, features/, skills/, junk/, prompts/, CYCLES.md, STYLES.md) is handled by running `projinit` on the target — that script creates the scaffold without touching existing files. The conversion protocol just needs to:
1. Discover what exists
2. Map old → new structure
3. Archive old docs
4. Fill in DOCKS.md files
5. Run `projinit` for the scaffold

---

## PHASE 1: DISCOVER & AUDIT (Paper Only — No Changes)

### 1.1 — Catalog What Exists
Scan the entire project. Build a complete map of every documentation-related file and folder:

| Old System Pattern | Examples | Our System Equivalent |
|---|---|---|
| Numbered folders | `01-FEATURES/`, `02-INSTRUCTIONS/` | `features/`, `protocols/` |
| Different names | `NOTES/`, `RAWS/`, `IDEAS/` | `genesis/` |
| Flat feature docs | `feature-x.md`, `admin-panel.md` | `features/FXX-name/DOCKS.md` |
| Single README | `README.md` describing the project | → extract into `genesis/ORIGINAL IDEA.md` |
| Old AGENTS.md | Any prior AI instruction file | → read for project context, replace with new |
| No documentation | Just code, `package.json`, config files | → discover from codebase (1.4) |
| Code comments | JSDoc, TODO comments, inline docs | → read for feature understanding |
| Git history | Commits, branches, PR descriptions | → scan for feature evolution clues |
| Config files | `package.json`, `tsconfig`, `vite.config` | → extract project type, tools, structure |

### 1.2 — Classify the Project
Determine what kind of project this is:

- **Documented (old system):** Has an organized doc structure (numbered folders like `01-FEATURES/`, old AGENTS.md, feature folders like `GM/`, `GENERAL/`, `NOTES/`).
- **Partially documented:** Has some `.md` files, maybe a README, but no consistent management system.
- **UNDOCUMENTED (code only):** **No documentation at all.** No README, no AGENTS.md, no feature docs, no notes. Just source code, config files, and maybe a `package.json`. This is common — many projects have zero docs. The protocol handles this by analyzing the codebase from scratch (see 1.4).

### 1.3 — Audit Old Documentation (If Exists)
If the project has documentation:
1. Read EVERY existing documentation file
2. Map each to the closest equivalent in our system:
   - Old feature folders → `features/FXX-name/DOCKS.md`
   - Old instruction/protocol files → `protocols/` (only if user wants them)
   - Old notes/ideas → `genesis/` or `genesis/FXX-raw/`
   - Old project description → `genesis/ORIGINAL IDEA.md`
3. Identify what's MISSING — what features does the old system reference that have no docs?
4. Identify what's OBSOLETE — old protocols that don't apply to our system
5. Present a mapping table to the user:

```markdown
## Conversion Map

| Old Location | Content | New Location | Action |
|---|---|---|---|
| 01-FEATURES/F1-Courses/ | Course page feature docs | features/F01-courses/DOCKS.md | Convert |
| 02-INSTRUCTIONS/ | Old protocols | [skip] | Archive only |
| 04-NOTES/raw-idea.md | Original project idea | genesis/ORIGINAL IDEA.md | Convert |
| README.md | Project description | genesis/ORIGINAL IDEA.md | Extract key parts |
```

**User must approve this map before anything moves.**

### 1.4 — Discover From Codebase (For Undocumented Projects)
If the project has **ZERO documentation** (no README, no docs folder, no AGENTS.md, nothing — just code), the AI must figure out what this project is entirely from the codebase. This is the hardest case and requires the most work.

1. **Read config files** to understand the tech stack:
   - `package.json` → framework, dependencies, scripts, project name
   - `tsconfig.json` / `jsconfig.json` → TypeScript/JS structure
   - `vite.config.ts` / `next.config.js` / `webpack.config.js` → bundler, routing
   - `docker-compose.yml` / `Dockerfile` → services, containerization
   - `.env.example` / `.env` → external dependencies, API keys needed
   - `firebase.json` / `supabase/config.toml` / `netlify.toml` → hosting, backend services
   - `Cargo.toml` / `go.mod` / `Gemfile` / `requirements.txt` → language-specific configs
2. **Read source structure** to understand the architecture:
   - Entry points (`index.ts`, `main.tsx`, `App.tsx`, `server.js`)
   - Routes/pages (`routes/`, `pages/`, `app/`, `screens/`)
   - Components (`components/`, `ui/`, `widgets/`)
   - API/service layer (`api/`, `services/`, `controllers/`, `handlers/`)
   - Database schema / ORM models (`models/`, `schema/`, `migrations/`)
   - State management (`stores/`, `contexts/`, `reducers/`)
3. **Scan git log** for project history:
   - First commit → when was this started? What was the initial idea?
   - Major feature commits → what features were added over time?
   - Branch names → what workstreams existed?
4. **Deploy sub-agents** to analyze different parts in parallel:
   - Agent 1: Frontend features — scan routes, components, UI patterns, user flows
   - Agent 2: Backend features — scan API endpoints, controllers, services, middleware
   - Agent 3: Database/infra — scan schemas, migrations, config, deployment setup
   - Agent 4: Git history — extract feature evolution timeline, major milestones
5. **Synthesize** sub-agent findings into:
   - A project description → goes into `genesis/ORIGINAL IDEA.md`
   - A feature list → each becomes `genesis/FXX-raw/DOCKS.md`
   - A dependency map → what features depend on what

**After discovery, present to user:**
> "This project has NO documentation. I analyzed the codebase and found [N] features: [list]. I've created raw DOCKS.md files in `genesis/` for each. Please review and tell me which are correct, which are missing, and which to promote to `features/`."

### 1.5 — Propose the Conversion
Present the complete plan to the user:

```markdown
## Conversion Plan for [Project Name]

### What exists:
- [Summary of what was found — docs, code, old system]

### What will be created:
- `genesis/ORIGINAL IDEA.md` — from [source]
- `features/F01-name/DOCKS.md` — from [source]
- `features/F02-name/DOCKS.md` — from [source]
- ... (all features)

### What will be archived:
- `features/_archive/old-system/` — old doc structure preserved

### What stays untouched:
- All source code
- All config files
- All assets
- node_modules, .git, etc.

### What gets installed:
- AGENTS.md (new system)
- protocols/ (all 7 protocols)
- CYCLES.md (empty, ready for cycles)
- skills/, junk/, prompts/ (empty scaffold)
```

**User must approve this plan before anything is created or moved.**

---

## PHASE 2: EXECUTE CONVERSION (After User Approval)

### 2.1 — Install the System
Run `projinit` on the project. This installs the scaffold (AGENTS.md, protocols/, etc.) while preserving all existing files.

### 2.2 — Archive the Old System
Move old documentation IN FULL to `features/_archive/old-system/`:
```
features/_archive/old-system/
├── 01-FEATURES/         ← original feature docs preserved
├── 02-INSTRUCTIONS/     ← original protocols preserved
├── 04-NOTES/            ← original notes preserved
├── old-AGENTS.md        ← original AGENTS.md preserved
└── README.md            ← original README preserved
```
**Nothing gets deleted. Everything gets preserved in `_archive/`.**

### 2.3 — Create New Documentation
Based on the approved Phase 1 map:

1. **Create `genesis/ORIGINAL IDEA.md`** from the project description
2. **Create `features/DOCKS.md` index** listing all discovered features
3. **Create `features/FXX-name/DOCKS.md`** for each feature — start as raw features in genesis first if they need more exploration
4. **Create `CYCLES.md`** with Cycle 0 and Cycle 1 populated from the discovered feature list
5. **Fill in each DOCKS.md** with whatever documentation existed in the old system — mark gaps with `[TODO: needs audit]`

### 2.4 — Handle Undocumented Projects
For projects discovered from code only:
1. Create raw feature DOCKS.md files in `genesis/FXX-raw/` (not `features/` yet — they need user review)
2. Each raw DOCKS.md gets a `[DISCOVERED FROM CODE]` tag
3. Present to user: "I found these features in the codebase. Each has a raw DOCKS.md in genesis/. Review and promote to features/ when ready."
4. Run AUDIT (P01) on each raw feature after user confirms the feature list

### 2.5 — Clean Up
- Remove old empty folders if user approves (the archived versions exist in `_archive/`)
- Update `features/DOCKS.md` index
- Verify `CYCLES.md` is accurate
- Commit everything

---

## EXECUTION CONSTRAINTS

1. **NEVER DELETE.** Old documentation goes to `_archive/`. Never delete user content.
2. **ASK FIRST.** Every mapping decision must be approved by the user before execution.
3. **PHASE 1 IS FREE.** The discovery/audit phase makes NO changes. Pure observation.
4. **PHASE 2 IS PRECISE.** Only after user says "go" does anything move.
5. **PRESERVE STRUCTURE.** If old feature docs had sub-features, preserve that hierarchy.
6. **UNDOCUMENTED = DISCOVER.** For projects with no docs, deploy sub-agents to analyze the codebase. Delegate discoveries to the user for confirmation.
7. **OLD AGENTS.md IS DATA.** Read old AGENTS.md for project context but replace with new one.
8. **ONE CONVERSION AT A TIME.** Don't try to convert multiple projects simultaneously.

---

## COMPLETION CRITERIA

### Phase 1
- A complete catalog of existing documentation exists
- The project is classified as old system, partial, or undocumented
- A conversion map is presented to the user
- The user approves the plan

### Phase 2
- The `projinit` scaffold is installed
- Old documentation is archived to `features/_archive/old-system/`
- `genesis/ORIGINAL IDEA.md` exists
- `features/DOCKS.md` indexes the feature tree
- Every feature has a DOCKS.md in `features/` or `genesis/`
- `CYCLES.md` is populated
- Nothing is deleted: everything is preserved or archived
