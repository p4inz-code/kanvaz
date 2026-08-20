# Kanvaz — Audit Methodology

*How this project does a pre-release review pass. Reusable, not a one-off —
run this same process for every significant feature, not just this one.*

## When to run this

Any change that meaningfully expands what's reachable — a new IPC surface, a
new permission/trust boundary, a new plugin capability, anything MCP Bridge
touches. Not needed for a small UI fix or a copy change. Rule of thumb: if
the change is big enough to get its own CHANGELOG section, it's big enough
for this pass before that section gets written as "shipped."

## The process (what actually happened for v4.4.0, do it the same way again)

1. **Implement first, review second.** Don't try to review-as-you-go — build
   the real thing, get it passing the normal test suite, then step back and
   review the finished diff as a whole. Findings are cheaper to act on
   against a complete, coherent change than a half-built one.

2. **Fan out N independent review agents in parallel, each with a distinct
   lens, each blind to the others' findings.** For v4.4.0 this was 7 lenses
   plus one bonus:
   - **Security / red-team** — malicious plugin, privilege escalation,
     injection, the actual attack surface a feature adds.
   - **Correctness / reliability** — race conditions, error handling, edge
     cases, resource cleanup (leaked listeners, dangling timers, unclosed
     handles).
   - **Electron / IPC boundary** — main/renderer trust boundary,
     contextIsolation integrity, whether a new channel is reachable by more
     than what's intended.
   - **Plugin-author ergonomics** — would a third-party developer actually
     be able to use this correctly, or is there a footgun the code doesn't
     protect against.
   - **Privacy / offline-ethos** — does it uphold "100% offline by default,
     every network call disclosed" (Kanvaz's one non-negotiable promise);
     does documentation claim more than the code actually guarantees.
   - **Performance / resource-safety** — leaks, unbounded growth, blocking
     operations — but stay honest about severity at Kanvaz's real scale (a
     single user's local board), don't inflate non-issues.
   - **End-user QA flow** — trace the actual UI code path as a real user
     would experience it; copy/UX consistency with existing Kanvaz tone.
   - **Cross-file consistency** (bonus, catches what no single-file review
     can) — do all the pieces actually wire together: version strings, IDs
     matching across files, test fixtures actually exercising the real
     source, CI script correctness.

   Each agent gets the same real instruction: run `git diff`/`git status`
   yourself, read the actual changed files, don't work from a summary. Give
   each one 4-6 concrete, specific things to check — not "review this for
   bugs," but the actual scenarios worth checking (see the v4.4.0 session
   transcript for the exact prompts used, they're a good template). Cap each
   report at ~800 words, most severe first, file:line citations, root cause
   not just symptom.

3. **Cross-verify.** When two independent lenses catch the same underlying
   issue from different angles (v4.4.0: the listener-stacking bug was caught
   independently by both the correctness and QA passes), that's a strong
   signal it's real, not a false positive from one agent's framing.

4. **Fix root causes, not symptoms.** A "fix" that just papers over the
   symptom without understanding why it happened isn't done. For every
   finding: state the failure scenario concretely, then the root cause
   (missing check / wrong assumption / ordering issue), then fix that.

5. **Add a regression test for anything an automated test CAN catch**, not
   just a code comment. And — this part actually matters, don't skip it —
   **verify the test really catches the bug**: temporarily revert the fix,
   run the test, confirm it fails, then restore the fix and confirm it
   passes again. A regression test that would pass either way isn't proving
   anything. (v4.4.0's `test/plugin-scope-test.js` concurrency check was
   verified exactly this way before being trusted.)

6. **Some findings aren't fixable this pass — say so plainly, don't hide
   it.** v4.4.0's `mcp-invoke` shared-broadcast-channel limitation needs real
   per-process plugin isolation to fully close, which is separately,
   deliberately out of scope for this project right now. The honest move was
   disclosing it clearly in `SECURITY.md` with a concrete mitigation
   ("only install plugins you trust just as much") rather than pretending
   the object-level gate was a complete fix. A documented, disclosed
   limitation is a legitimate outcome of this process — a silently dropped
   finding is not.

7. **Write it all up in three places, not just the code:**
   - `CHANGELOG.md` — a "Fixed" subsection under the version's entry, one
     line per finding, what it was and what changed.
   - `SECURITY.md` — if anything touches the trust model, correct the
     disclosure to match reality, don't leave an overstated claim standing.
   - `docs/HANDOFF.md` — an honest "consciously not done" list for whatever
     genuinely couldn't be verified in this environment (this sandbox can't
     run the real Electron GUI, and can't test against the actual Claude
     Desktop app — only a real MCP SDK client in a headless test). Say
     exactly what was verified instead, not just what wasn't done.

## Why this is worth the overhead

The v4.4.0 pass caught a CRITICAL bug (a plugin could forge full `mcpBridge`
access by calling the scope-builder on itself with a fake manifest —
completely defeating the permission gate the whole feature was built
around) that static self-review during implementation missed. It also caught
a real concurrency bug and a listener-stacking bug that would have shipped
as "it works" based on the happy-path testing that happens naturally during
implementation. None of those were exotic edge cases — they were the kind of
thing that shows up the first time a real user does something slightly out
of the expected sequence (toggle a feature off and on, click a button twice,
run two operations concurrently). The multi-lens structure is what surfaces
them: no single reviewer instruction covers "race condition AND privilege
escalation AND UX copy AND CI script correctness" as well as five separate
reviewers each pushed hard on their own lens.
