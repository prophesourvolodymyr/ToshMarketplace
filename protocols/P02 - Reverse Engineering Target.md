# REV-01: Ruthless Reverse Engineering Protocol

**System ID:** `REV-01`
**Trigger:** User says "reverse engineer [feature]", "how does [app] do [X]", "figure out how [thing] works", or when blocked on an implementation.
**Input Requirement:** Specific feature/behavior to reverse engineer. Target app name/URL if known.
**Output Target:** `features/[FeatureName]/RE-RESEARCH/` — all findings, extracted logic, and reimplementation specs.

---

## PHASE 0: TARGET CATALOGUING (Intelligence Gathering)

**Goal:** Find every app, repo, library, or tool that implements the feature we want. Leave no stone unturned.

### P0.1 — Web Research
- Search for: `"[feature description]" open source github`, `"[feature description]" app`, `"[competitor app]" how it works`
- Search for: patents, technical blog posts, conference talks, whitepapers about the feature
- Search for: Stack Overflow threads where people discuss implementing similar things
- Search for: academic papers if the feature involves novel algorithms

### P0.2 — Build Target Catalog
Create a prioritized list of targets:
```
TARGETS.md:
- T1: [App Name] — priority HIGH — type: open-source/repo — URL: github.com/...
- T2: [App Name] — priority HIGH — type: closed-source/ios — App Store: ...
- T3: [App Name] — priority MEDIUM — type: web-app — URL: ...
- ...
```

### P0.3 — Tool Readiness Check & Auto-Install
AI MUST check which reverse engineering tools exist on the system. For missing tools: AI tries to install them itself first.

**Step 1: Inventory what's installed:**
```bash
which ghidra jadx apktool frida mitmproxy strings objdump otool class-dump jadx-gui de4js
brew list --formula 2>/dev/null | grep -E "ghidra|jadx|apktool|mitmproxy|binwalk|hopper"
npm list -g --depth=0 2>/dev/null | grep -E "de4js|@electron/asar"
pip3 list 2>/dev/null | grep -iE "frida-tools|uncompyle6|androguard"
gem list 2>/dev/null | grep -iE "cfpropertylist|plist"
```

**Step 2: Auto-install what's missing (try HARD):**
```bash
# npm packages (AI can always try this)
npm install -g de4js @electron/asar

# pip packages (AI can always try this)
pip3 install frida-tools uncompyle6 androguard

# brew packages (may need user password — TRY FIRST, ask only if it fails)
brew install ghidra jadx apktool mitmproxy binwalk

# Go tools
go install github.com/...  # if applicable

# Rust tools via cargo
cargo install ...  # if applicable
```

**Step 3: Only if auto-install fails** (permission denied, no brew, etc.) — tell user exactly what to run and why:
> "I need `jadx` to decompile this Android APK — please run: `brew install jadx`"

**RULE:** AI does ALL the reverse engineering. User is NOT expected to run analysis commands. User only does system-level installs when AI's attempts fail, and provides hardware/logins when needed.

---

## PHASE 1: ACQUISITION (Get the Target)

### P1.1 — Open Source
```bash
git clone <url> features/<FeatureName>/RE-RESEARCH/repos/<repo-name>/
# Clone with full history for blame analysis
git clone --depth=1 <url>  # shallow clone if huge
```

### P1.2 — Closed Source Mobile (iOS)
- Download `.ipa` via Apple Configurator 2, ipatool, or ask user
- Extract: `unzip app.ipa -d extracted/`
- Decrypt binary: use `bfdecrypt` (jailbroken) or `frida-ios-dump`
- Extract strings: `strings Payload/App.app/App > strings.txt`
- Class dump: `class-dump -H -o headers/ Payload/App.app/App`
- *If jailbroken device available:* use Frida to dump classes at runtime

### P1.3 — Closed Source Mobile (Android)
- Download APK from APKMirror, APKPure, or `adb pull`
- Decompile: `apktool d app.apk -o apktool-output/`
- Decompile to Java: `jadx -d jadx-output/ app.apk`
- Extract native libs: `unzip app.apk -d extracted/` → `lib/` folder
- Native lib analysis: feed `.so` files to Ghidra

### P1.4 — Web Apps
- Open in browser → DevTools → Sources tab → search for key terms
- Check for source maps (`.map` files) — they expose original source
- Capture all network traffic via DevTools Network tab (preserve log)
- Use `mitmproxy` to intercept if HTTPS pinning is weak
- Check for undocumented API endpoints
- `wget --mirror` or save full HAR archive if needed
- Check for `wasm` files, `web_assembly` — decompile with `wasm-decompile`

### P1.5 — Desktop Apps (macOS)
```bash
# Extract app bundle
cp -R /Applications/Target.app features/<FeatureName>/RE-RESEARCH/targets/

# Static analysis
otool -L Target.app/Contents/MacOS/Target  # linked libraries
nm Target.app/Contents/MacOS/Target | grep -i <keyword>  # symbols
strings Target.app/Contents/MacOS/Target > strings.txt
class-dump-swift Target.app  # if Swift
```
- Open binary in Hopper or Ghidra for full disassembly

### P1.6 — Electron Apps
```bash
npx @electron/asar extract app.asar extracted-app/
# Now you have full source code
```

### P1.7 — Browser Extensions
- Chrome: `chrome://extensions/` → enable Developer Mode → extension ID
- Source at: `~/Library/Application Support/Google/Chrome/Default/Extensions/<ID>/`
- Or download `.crx` and unzip

### P1.8 — API/Backend
- Proxy traffic: `mitmproxy --mode regular@8080` or Charles Proxy
- Swagger/OpenAPI discovery: try `/swagger.json`, `/api-docs`, `/openapi.json`
- GraphQL introspection: `__schema` query if enabled
- Rate limit bypass: slow, distributed requests; rotate User-Agent

---

## PHASE 2: STATIC ANALYSIS (No Execution — Read the Code/Binary)

### P2.1 — Source Code Analysis (Open Source)
- Find the feature entry point: grep for UI labels, route names, feature-flag strings
- Trace the call chain: entry → handler → service → data layer
- Map data flow: what inputs → what transforms → what outputs
- Document patterns: state management, caching, error handling, edge cases

### P2.2 — Binary Static Analysis (Closed Source)
- **Strings dump:** `strings binary > strings.txt` — grep for feature-related keywords, error messages, log strings, URL paths, selector names
- **Symbol table:** `nm binary` — find function names, global variables
- **Linked libraries:** `otool -L binary` — reveals dependencies and frameworks used
- **Disassembly (Ghidra/Hopper/IDA):**
  - Find key strings in binary → cross-reference to functions that use them
  - Rename functions as you understand them
  - Export pseudocode for key functions
  - Follow the call graph from feature entry to feature output

### P2.3 — Decompiled Code Analysis
- Read decompiled Java/Swift/Kotlin/C# like source code
- Focus on the feature's class hierarchy, not the whole app
- Look for: delegate patterns, notification names, KVO keys, NSUserDefaults keys, intent filters, broadcast receivers

### P2.4 — Static Analysis Checkpoint (Plain English)
After static analysis on a target, write a brief plain-English summary:
```
## STATIC ANALYSIS CHECKPOINT: [Target Name]

**What I found:**
- The feature lives in [file/class/binary section]
- It uses [these libraries/frameworks]
- The data flows like: [simple description]
- I see calls to [these APIs/endpoints]

**What I still DON'T know (will need dynamic analysis):**
- [List gaps — runtime behavior, exact sequences, timing]

**Worth continuing with this target?** [YES/NO — and why]
```
Present this to user before moving to Phase 3.

---

## PHASE 3: DYNAMIC ANALYSIS (Runtime — See It in Action)

### P3.1 — Run the Target
- Install and run the app (ask user if manual login/device needed)
- Trigger the specific feature
- Observe all outputs: UI changes, network calls, file changes, logs

### P3.2 — Network Monitoring
```bash
# mitmproxy
mitmproxy --mode transparent
# Or Charles Proxy GUI
# Or Wireshark for non-HTTP
```
- Capture the exact API calls the feature makes
- Note: endpoints, headers, auth tokens, request/response shape
- Replay requests to understand idempotency and rate limits

### P3.3 — Runtime Instrumentation (Frida — Universal)
**If frida not installed: try `pip3 install frida-tools` yourself. Only ask user if it fails.**
```javascript
// Frida script to hook a specific function
Interceptor.attach(Module.findExportByName(null, "target_function"), {
    onEnter: function(args) { console.log("ARG0:", args[0]); },
    onLeave: function(retval) { console.log("RET:", retval); }
});
```
- Trace Objective-C messages (iOS): `frida-trace -U -m "-[TargetClass *]" App`
- Trace Java methods (Android): `frida-trace -U -j "com.target.Class!*" App`
- Can modify return values live to test hypotheses

### P3.4 — Debugger Attachment
- **iOS:** `lldb -p <pid>` (needs entitlement/signing, jailbreak helps)
- **Android:** `adb jdwp` + `jdb -attach`
- **Desktop:** `gdb -p <pid>`, `lldb -p <pid>`

### P3.5 — Filesystem & Log Monitoring
```bash
# macOS/iOS Simulator
fs_usage -w -f filesys | grep <appname>

# Android
adb logcat | grep <package>

# General
lsof -p <pid>
```

### P3.6 — Dynamic Analysis Checkpoint (Plain English)
After dynamic analysis, update the plain-English picture:
```
## DYNAMIC ANALYSIS CHECKPOINT: [Target Name]

**Confirmed from static analysis:**
- [What we saw statically that matches runtime behavior]

**New discoveries at runtime:**
- [Things we only saw by running the app — network calls, state changes, timing]

**The complete picture so far:**
[Simple flow: User taps X → app does Y → server responds Z → UI shows W]

**Still unknown / deeper to dig:**
- [Edge cases not triggered, background behavior, etc.]
```
Present this to user before moving to Phase 4.

---

## PHASE 4: FEATURE ISOLATION (Extract the Specific Logic)

### P4.0 — PLAIN ENGLISH EXTRACTION (Explain to User)
**BEFORE writing pseudo-code, explain the extracted logic to the user in plain English.**

The user is not a reverse engineer. They need to understand what was found so they can connect the dots. Use analogies, simple terms, and diagrams (ASCII or mermaid in markdown).

Format:
```
## WHAT I FOUND (Plain English)

**How [App X] does [Feature Y]:**

1. When you tap the button, the app grabs [these 3 pieces of data] from [this source]
2. It then combines them using [simple operation — like "multiplies the screen brightness by the current time"]
3. Before sending to the server, it [transforms it — like "wraps it in encryption using a key from the device"]
4. The server responds with [this shape of data], and the app displays it by [simple description]

**The "trick" they use:**
[If there's a non-obvious clever thing — describe it simply]

**Why it works the way it does:**
[Connect the dots — why did they build it this way? What problem were they solving?]

**What we can copy vs what we should do differently:**
[Honest assessment]
```

Do this after completing P2 or P3 on a target. User must understand the logic before we move to reimplementation.

### P4.1 — Isolate the Algorithm
- From all gathered data, distill the feature into:
  1. **Inputs:** What data does the feature consume?
  2. **Processing:** What transforms happen? In what order?
  3. **Outputs:** What is produced?
  4. **State:** What is remembered between invocations?
  5. **Side effects:** Network calls, file writes, database changes
  6. **Edge cases:** How does it handle errors, empty states, loading?

### P4.2 — Write Pseudo-Logic
```python
# PSEUDO-LOGIC.py — not runnable, just the extracted algorithm
def feature_logic(input_A, input_B):
    # Step 1: Validate inputs
    if not valid: return error
    
    # Step 2: Transform (extracted from reverse engineering)
    intermediate = transform_a(input_A) + transform_b(input_B)
    
    # Step 3: Side effect (network call pattern observed)
    response = api_call("/endpoint", {"data": intermediate})
    
    # Step 4: Post-process
    return map_response(response, format=X)
```

### P4.3 — Document Unknowns
```markdown
## UNKNOWNS.md
- How is the `auth_token` generated? (seems to be HMAC-SHA256 with device fingerprint — P3.2)
- What is the exact hashing algorithm in step 2? (looks like xxHash with custom seed — P2.2)
- The retry logic is unclear — only triggered once during P3.1, need more observation
```

---

## PHASE 5: REIMPLEMENTATION (Port to Target Platform)

### P5.1 — Match the Logic
- Translate pseudo-logic into target language (Swift, Kotlin, TypeScript, Rust, etc.)
- Adapt to project's architecture patterns
- Handle platform-specific differences (e.g., iOS Keychain vs Android Keystore)

### P5.2 — Preserve the "Secret Sauce"
- If the feature has unique UX behavior (animations, haptics, timing), replicate that
- If it has a clever algorithm, preserve the cleverness

### P5.3 — Write Tests Against the Original
- If possible, run same inputs through original app and new implementation
- Compare outputs — they should match

---

## PHASE 6: VALIDATION (Did We Get It Right?)

### P6.1 — Side-by-Side Testing
- Same inputs → Same outputs
- Same edge cases → Same error handling
- Same performance characteristics (within reason)

### P6.2 — Document Deviations
```markdown
## DEVIATIONS.md
- We use `libsodium` instead of custom crypto (functionally equivalent, more secure)
- We skip the telemetry call (not needed for functionality)
- We batch network calls differently (platform optimization)
```

### P6.3 — Capture Gaps
- Did we miss anything? Can we test more edge cases?
- Is there behavior we couldn't observe because it requires rare conditions?

---

## PHASE 7: KNOWLEDGE ARCHIVE

### P7.1 — Save Everything
```
features/<FeatureName>/RE-RESEARCH/
  ├── TARGETS.md              — catalog of all targets explored
  ├── TOOLS.md                — tools used and how
  ├── repos/                  — cloned open source repos
  ├── targets/                — acquired closed source binaries/APKs/IPAs
  ├── PHASE2-static/          — strings dumps, decompiled code, pseudocode exports
  ├── PHASE3-dynamic/         — HAR files, Frida scripts, logs, captured requests
  ├── PHASE4-feature/         — PSEUDO-LOGIC.py, data flow diagrams, call graphs
  ├── UNKNOWNS.md             — things we still don't know
  ├── DEVIATIONS.md           — where our implementation differs
  └── REIMPLEMENTATION.md     — final spec for the reimplementation
```

---

## EXECUTION CONSTRAINTS

1. **ALWAYS ASSUME THERE IS MORE:** Never stop at surface-level findings. The first thing you find is rarely the whole picture. Ask:
   - "What happens in the error case?"
   - "What if the input is empty/malformed/huge?"
   - "Is there a background service doing work I haven't seen?"
   - "Are there multiple code paths for different conditions?"
   - "Is there caching/retry/offline logic I haven't triggered yet?"
   - "Does this feature behave differently on first launch vs subsequent?"
   - "Is there A/B testing or feature flags hiding alternative implementations?"
   - "What dependencies does this feature pull in — do they have their own logic?"
   
   **Dig until you find the hidden parts.** The user wants the COMPLETE picture, not the obvious 80%.

2. **NEVER GIVE UP:** If one approach dead-ends, pivot to another. Static failed? Go dynamic. Dynamic blocked? Find an open source clone. No clone? Read patents. No patents? Find forum discussions where devs hint at the approach. Exhaust every avenue.

3. **AI DOES ALL THE REVERSE ENGINEERING:** The user is NOT a reverse engineer. They don't run commands, don't analyze binaries, don't read decompiled code. AI handles everything technical. User only:
   - Installs apps from App Store / logs into services (things requiring human identity)
   - Provides physical hardware (jailbroken device, USB cable, etc.)
   - Approves purchases of paid tools if Ghidra isn't enough
   - Answers domain questions ("what should this feature do?")

4. **EXPLAIN IN PLAIN ENGLISH:** Whenever you extract something — an algorithm, a data flow, a trick — explain it to the user in simple terms FIRST. They need to "connect the dots" and understand the logic at a high level. Use analogies. Use diagrams. Then write the pseudo-code.

5. **PARALLELIZE:** Phase 2 static analysis on multiple targets can run in parallel. Do it.

6. **DOCUMENT AS YOU GO:** Don't wait until the end. Write findings immediately.

7. **CHECKPOINT:** After each phase, summarize findings to user in plain English and ask:
   - "Is this enough to implement, or should I go deeper?"
   - "Should I pivot to a different target, or continue with this one?"

8. **ETHICAL BOUNDARY:** This protocol is for understanding how things work to build your own implementation. It is NOT for:
   - Stealing proprietary code verbatim
   - Bypassing DRM to pirate software
   - Violating terms of service in illegal ways
   - Breaking encryption you don't have rights to break

---

## COMPLETION CRITERIA

- The target catalog is comprehensive and searches all categories
- At least one target is fully analyzed through static or dynamic analysis
- A plain-English explanation is delivered and understood by the user
- Feature logic is documented as pseudo-code
- All unknowns are explicitly listed and each is investigated at least once
- Error paths, edge cases, and background behavior are checked, not only the happy path
- The reimplementation specification is complete enough to build from
- The knowledge archive is saved in `RE-RESEARCH/`

---

## APPENDIX A: COMPREHENSIVE TARGET-TO-TOOL MATRIX

Every category of thing that can be reverse engineered, and the exact tools/commands for each.

### A1. Open Source Code
| Target | Tool | Command |
|---|---|---|
| GitHub/GitLab repo | `git` | `git clone <url>` / `git clone --depth=1` |
| npm package | `npm` | `npm pack <package> && tar -xzf *.tgz` |
| pip package | `pip` | `pip download <package> --no-binary :all: && tar -xzf *.tar.gz` |
| cargo crate | `cargo` | `cargo download <crate> && tar -xzf *.crate` |
| Any tarball | `tar`/`unzip` | `tar -xzf` / `unzip` |

### A2. iOS Apps (.ipa)
| Purpose | Tool | Command |
|---|---|---|
| Extract IPA | `unzip` | `unzip app.ipa -d extracted/` |
| Download IPA | `ipatool` | `ipatool download -b <bundle-id>` |
| Decrypt binary | `frida-ios-dump` / `bfdecrypt` | (requires jailbroken device) |
| Dump Obj-C headers | `class-dump` | `class-dump -H -o headers/ Payload/App.app/App` |
| Dump Swift headers | `class-dump-swift` | `class-dump-swift App.app` |
| String extraction | `strings` | `strings Payload/App.app/App > strings.txt` |
| Linked libraries | `otool` | `otool -L Payload/App.app/App` |
| Symbol table | `nm` | `nm Payload/App.app/App` |
| Disassembly (GUI) | `Ghidra` / `Hopper` / `IDA Pro` | Open binary in tool |
| Runtime hooking | `Frida` | `frida-trace -U -m "-[TargetClass *]" App` |
| Debugger | `lldb` | `lldb -p <pid>` |
| Filesystem monitor | `fs_usage` | `fs_usage -w -f filesys \| grep App` |
| Plist inspection | `plutil` | `plutil -p Info.plist` |
| Asset extraction | `assetutil` | `assetutil --info Assets.car` |

### A3. Android Apps (.apk / .aab)
| Purpose | Tool | Command |
|---|---|---|
| Download APK | `apkmirror` (web) / `adb pull` | `adb pull /data/app/<package>/base.apk` |
| Decompile resources | `apktool` | `apktool d app.apk -o apktool-out/` |
| Decompile to Java | `jadx` | `jadx -d jadx-out/ app.apk` |
| Decompile to Java (GUI) | `jadx-gui` | `jadx-gui app.apk` |
| Extract APK | `unzip` | `unzip app.apk -d extracted/` |
| DEX to JAR | `dex2jar` / `d2j-dex2jar` | `d2j-dex2jar classes.dex` |
| JAR viewer | `JD-GUI` / `jadx-gui` | Open jar in tool |
| Native .so analysis | `Ghidra` | Feed `lib/arm64-v8a/*.so` to Ghidra |
| String extraction | `strings` | `strings lib/arm64-v8a/libnative.so > strings.txt` |
| Runtime hooking | `Frida` | `frida-trace -U -j "com.app.Class!*" App` |
| ADB logcat | `adb` | `adb logcat \| grep <package>` |
| ADB shell | `adb` | `adb shell` then `dumpsys`, `pm list packages`, etc. |
| Debugger | `jdb` | `adb forward tcp:8700 jdwp:<pid> && jdb -attach localhost:8700` |
| Manifest analysis | `aapt` / `apkanalyzer` | `aapt dump badging app.apk` |
| Smali analysis | `apktool` | Read `apktool-out/smali/` directly |

### A4. Web Apps (SPAs, PWAs, Websites)
| Purpose | Tool | Command |
|---|---|---|
| Source viewing | Chrome DevTools | Sources tab → search keywords |
| Source maps | Chrome DevTools | Sources tab → look for `.map` files |
| Deobfuscate JS | `de4js` | `de4js obfuscated.js` or https://de4js.kshift.me |
| Network capture | Chrome DevTools | Network tab → preserve log → export HAR |
| HTTPS intercept | `mitmproxy` | `mitmproxy --mode regular@8080` |
| HTTPS intercept (GUI) | `Charles Proxy` | GUI app |
| Full mirror | `wget` | `wget --mirror --page-requisites <url>` |
| WebAssembly | `wasm-decompile` | `wasm-decompile module.wasm -o out.dcmp` |
| WebAssembly (WABT) | `wasm2wat` | `wasm2wat module.wasm -o module.wat` |
| API discovery | curl + wordlist | `ffuf -w endpoints.txt -u <url>/FUZZ` |
| GraphQL introspection | curl | `curl -X POST <url> -d '{"query":"{__schema{types{name}}}"}'` |
| JavaScript beautify | `js-beautify` | `js-beautify minified.js > readable.js` |
| Cookie/localStorage | Chrome DevTools | Application tab |
| WebSocket capture | Chrome DevTools | Network → WS tab |
| Service Worker | Chrome DevTools | Application → Service Workers |
| Lighthouse trace | Chrome DevTools | Lighthouse → view trace |

### A5. macOS Desktop Apps (.app)
| Purpose | Tool | Command |
|---|---|---|
| Extract bundle | `cp` | `cp -R /Applications/App.app targets/` |
| Linked frameworks | `otool` | `otool -L App.app/Contents/MacOS/App` |
| Symbols | `nm` | `nm App.app/Contents/MacOS/App` |
| Strings | `strings` | `strings App.app/Contents/MacOS/App > strings.txt` |
| Disassembly (GUI) | `Ghidra` / `Hopper` / `IDA` | Open binary |
| Obj-C headers | `class-dump` | `class-dump -H -o headers/ App.app` |
| Swift headers | `class-dump-swift` | `class-dump-swift App.app` |
| Debugger | `lldb` | `lldb -p <pid>` or `lldb App.app/Contents/MacOS/App` |
| Syscall trace | `dtruss` / `dtrace` | `sudo dtruss -p <pid>` |
| Filesystem trace | `fs_usage` | `sudo fs_usage -w -f filesys \| grep App` |
| Network trace | `nettop` / `tcpdump` | `sudo tcpdump -i en0 -w capture.pcap` |
| Process info | `vmmap` / `heap` | `vmmap <pid>` / `heap App` |
| Mach-O analysis | `MachOView` / `jtool` | `jtool -l App.app/Contents/MacOS/App` |
| Plist inspection | `plutil` / `defaults` | `plutil -p Info.plist` |

### A6. Windows Desktop Apps (.exe / .dll)
| Purpose | Tool | Command |
|---|---|---|
| Disassembly | `Ghidra` / `IDA Pro` / `x64dbg` | Open binary in tool |
| .NET decompile | `dnSpy` / `ILSpy` / `dotPeek` | Open .exe/.dll in tool |
| Strings | `strings` (sysinternals) | `strings.exe app.exe > strings.txt` |
| PE analysis | `PE-bear` / `CFF Explorer` | Open file |
| Dependency walk | `Dependency Walker` / `Dependencies` | Open file |
| API monitor | `API Monitor` / `WinDbg` | Attach to process |
| Registry monitor | `Process Monitor` (procmon) | Filter by process name |
| Network monitor | `Wireshark` / `Fiddler` | Capture traffic |
| Debugger | `x64dbg` / `WinDbg` / `OllyDbg` | Attach to process |
| DLL injection | Custom / `Injector` | (various) |
| Java decompile | `JD-GUI` / `CFR` / `Procyon` | `java -jar cfr.jar app.jar` |
| Python decompile | `uncompyle6` / `pycdc` | `uncompyle6 app.pyc` |
| AutoIT decompile | `Exe2Aut` | Open .exe |
| Installer extract | `7-Zip` / `lessmsi` / `innoextract` | Extract installer |

### A7. Linux Desktop Apps (ELF)
| Purpose | Tool | Command |
|---|---|---|
| Disassembly | `Ghidra` / `radare2` / `IDA` | Open binary |
| Strings | `strings` | `strings binary > strings.txt` |
| Symbols | `nm` / `objdump` | `nm -D binary` / `objdump -T binary` |
| Shared libs | `ldd` | `ldd binary` |
| Syscall trace | `strace` | `strace -p <pid> -o trace.log` |
| Library call trace | `ltrace` | `ltrace -p <pid> -o ltrace.log` |
| Debugger | `gdb` | `gdb -p <pid>` |
| Radare2 analysis | `r2` | `r2 -A binary` |
| Binary info | `file` / `readelf` | `file binary` / `readelf -a binary` |

### A8. Electron Apps (.asar)
| Purpose | Tool | Command |
|---|---|---|
| Extract asar | `@electron/asar` | `npx @electron/asar extract app.asar out/` |
| Debug main process | Chrome DevTools | Launch with `--remote-debugging-port=9222` |
| Debug renderer | Chrome DevTools | `Cmd+Opt+I` in app window |
| Find asar location | `find` | `find /Applications/App.app -name "*.asar"` |
| Read package.json | `@electron/asar` | Extract → read normally |

### A9. Browser Extensions (.crx / .xpi)
| Purpose | Tool | Command |
|---|---|---|
| Find extension source | Finder / Explorer | `~/Library/Application Support/Google/Chrome/Default/Extensions/<ID>/` |
| CRX download | `crxviewer` | https://robwu.nl/crxviewer/ |
| CRX extract | `unzip` / `CRX Viewer` | Rename .crx to .zip → unzip |
| Firefox .xpi | `unzip` | `unzip extension.xpi -d out/` |
| Source viewing | Chrome DevTools | `chrome://extensions/` → Inspect background page |
| Content script debug | Chrome DevTools | Right-click → Inspect → Sources → Content Scripts |

### A10. APIs & Backend Services
| Purpose | Tool | Command |
|---|---|---|
| HTTP proxy | `mitmproxy` | `mitmproxy --mode regular@8080` |
| HTTP proxy (GUI) | `Charles Proxy` | GUI app |
| HTTP proxy (CLI) | `Burp Suite` | Community edition |
| Packet capture | `Wireshark` / `tcpdump` | `tcpdump -i en0 -w capture.pcap` |
| API fuzzing | `ffuf` / `feroxbuster` | `ffuf -w wordlist.txt -u <url>/FUZZ` |
| OpenAPI discovery | `curl` | `curl <url>/swagger.json`, `/openapi.json`, `/api-docs` |
| GraphQL explore | `GraphQL Playground` / `Altair` | Desktop app or browser extension |
| gRPC reflection | `grpcurl` | `grpcurl <host>:<port> list` |
| WebSocket inspect | `websocat` / Chrome DevTools | `websocat ws://<url>` |
| JWT analysis | `jwt.io` / `pyjwt` | Paste token → decode |
| OAuth flow trace | Browser + Charles/mitmproxy | Capture redirect chain |
| Rate limit test | `vegeta` / `hey` | `echo "GET <url>" \| vegeta attack -rate=100` |

### A11. AI/ML Models
| Purpose | Tool | Command |
|---|---|---|
| Model visualization | `Netron` | `netron model.onnx` / https://netron.app |
| ONNX conversion | `onnx` / `torch.onnx` | `torch.onnx.export(model, dummy_input, "model.onnx")` |
| TensorFlow inspect | `saved_model_cli` | `saved_model_cli show --dir model/ --all` |
| PyTorch inspect | `torch.load` / `torch.jit.load` | Read state_dict, architecture |
| CoreML inspect | `coremltools` | `coremltools.models.MLModel("model.mlmodel")` |
| Model surgery | `numpy` + framework | Extract weights, analyze architecture |
| HuggingFace | `transformers` | `model.config`, `model.state_dict()` |
| TFLite inspect | `flatc` / `tflite` tools | `flatc -t schema.fbs -- model.tflite` |

### A12. Firmware & IoT Devices
| Purpose | Tool | Command |
|---|---|---|
| Firmware extraction | `binwalk` | `binwalk -e firmware.bin` |
| Filesystem unpack | `unsquashfs` / `jefferson` | `unsquashfs rootfs.squashfs` |
| U-Boot analysis | `uboot-tools` / `dumpimage` | `dumpimage -l uImage` |
| MCU disassembly | `Ghidra` (with CPU module) | Add processor module → open binary |
| JTAG/SWD debug | `OpenOCD` + `gdb` | `openocd -f board.cfg` |
| UART access | `screen` / `minicom` / `picocom` | `screen /dev/ttyUSB0 115200` |
| SPI/I2C sniff | Logic analyzer (`sigrok` / `PulseView`) | Hardware + software |
| Router firmware | `firmware-mod-kit` | `./extract-firmware.sh firmware.bin` |
| ESP32/ESP8266 | `esptool` | `esptool.py read_flash 0 0x400000 flash.bin` |

### A13. Game Engines
| Purpose | Tool | Command |
|---|---|---|
| Unity IL2CPP | `Il2CppInspector` / `Cpp2IL` | Extract `global-metadata.dat` + `libil2cpp.so` → generate C# |
| Unity Mono | `dnSpy` / `ILSpy` | Open `Assembly-CSharp.dll` |
| Unity assets | `AssetStudio` / `AssetRipper` / `UABE` | Open asset bundles / resources |
| Unreal Engine | `FModel` / `UE Viewer` | Open `.pak` / `.uasset` files |
| Godot | `gdsdecomp` | `gdsdecomp packfile.pck` |
| Ren'Py | `unrpyc` / `rpatool` | `unrpyc script.rpyc` |
| RPG Maker | `RPG Maker Decrypter` | Decrypt `.rgss*` files |

### A14. Databases
| Purpose | Tool | Command |
|---|---|---|
| PostgreSQL schema | `pg_dump` | `pg_dump --schema-only -h host -d db > schema.sql` |
| MySQL schema | `mysqldump` | `mysqldump --no-data -h host db > schema.sql` |
| SQLite extraction | `sqlite3` | `sqlite3 app.db .schema` |
| ORM reverse | Read migrations | `prisma migrate diff`, `alembic history`, `django showmigrations` |
| MongoDB structure | `mongosh` | `db.collection.findOne()` + `db.getCollectionInfos()` |
| Redis keyspace | `redis-cli` | `redis-cli KEYS '*'` / `SCAN 0` |

### A15. File Formats
| Purpose | Tool | Command |
|---|---|---|
| Binary analysis | Hex editor (`Hex Fiend`, `010 Editor`, `ImHex`) | Open file |
| Format description | `Kaitai Struct` | Write `.ksy` → compile → parse |
| Magic bytes | `file` | `file unknown.bin` |
| Text encoding detect | `uchardet` / `chardet` | `uchardet file.bin` |
| Archive detect | `binwalk` / `7z` | `binwalk file.bin` or `7z l file.bin` |
| Protobuf decode | `protoc` | `protoc --decode_raw < file.pb` |
| MessagePack | `msgpack-tools` / Python | `python -c "import msgpack; print(msgpack.load(open('file')))"` |
| BSON | Python `bson` | `bson.decode_all(open('file', 'rb').read())` |

### A16. Protocols (Network, Bluetooth, NFC)
| Purpose | Tool | Command |
|---|---|---|
| TCP/UDP capture | `Wireshark` / `tcpdump` | `tcpdump -i en0 -s 0 -w capture.pcap` |
| Bluetooth LE scan | `nRF Connect` / `LightBlue` | Mobile/desktop app |
| Bluetooth LE explore | `gatttool` / `bleak` | `gatttool -b <addr> --characteristics` |
| Bluetooth Classic | `Wireshark` + BTsnoop | Android: Enable HCI snoop log |
| Bluetooth HCI | `hcidump` | `hcidump -w capture.pcap` |
| NFC read | `nfc-tools` / `libnfc` | `nfc-list` / `nfc-mfclassic r a dump.mfd` |
| USB capture | `Wireshark` + USBPcap | Capture USB traffic |
| Custom dissector | `Wireshark` Lua plugin | Write `.lua` dissector |
| Serial protocol | `sigrok` + logic analyzer | Hardware capture → decode |

### A17. Cloud Infrastructure
| Purpose | Tool | Command |
|---|---|---|
| AWS reverse | `former2` / `terraformer` | Scan account → generate Terraform |
| GCP reverse | `terraformer` | `terraformer import google --resources="*"` |
| Azure reverse | `aztfy` / `terraformer` | `aztfy resource-group <rg>` |
| Terraform state | `terraform` | `terraform state list` + `terraform state show` |
| CloudFormation | `aws` CLI | `aws cloudformation describe-stack-resources` |
| Kubernetes | `kubectl` + `kube-score` | `kubectl get all -o yaml` |
| Docker compose | `docker` | `docker inspect` + `docker-compose config` |
| Helm charts | `helm` | `helm get manifest <release>` / `helm get values <release>` |

---

## APPENDIX B: QUICK AUTO-INSTALL COMMANDS (for AI Agent)

When a tool is missing, AI runs these in order until one succeeds:

```bash
# === PYTHON TOOLS ===
pip3 install frida-tools uncompyle6 androguard mitmproxy pycryptodome
pip3 install --user frida-tools

# === NODE TOOLS ===
npm install -g de4js @electron/asar js-beautify

# === BREW TOOLS (macOS) ===
brew install ghidra jadx apktool binwalk mitmproxy wireshark radare2 class-dump
brew install --cask charles hopper-disassembler

# === GO TOOLS ===
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# === RUST TOOLS ===
cargo install feroxbuster

# === RUBY GEMS ===
gem install cfpropertylist
```

**If `brew install` fails with permission error:** ask user to run the exact command.
**If `pip3 install` fails:** try `--user` flag, then `--break-system-packages` (if recent macOS Python).
**If nothing works:** tell user the exact error and the command they need to run. Do NOT give up silently — exhaust all auto-install paths first.
