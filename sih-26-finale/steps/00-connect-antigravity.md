# Connect an Antigravity window to the Obsidian vault

Paste the block below into **every new Antigravity chat, once, before any step prompt**. If you use one chat for everything, call it `AG-1`.

Don't paste a step prompt until the window replies `CONNECTED — AG-N` with vault numbers `0 / 0 / 0` and a pytest count. If it reports anything else, paste its reply into Claude.

---

```text
VAULT CONNECT — you are AG-N. Do this before any work.

Workspace root: /Users/adarshagarwala/Documents/sih26/sih-26-finale
Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11

1. Read these files in full, in this order:
   a. sih-26-finale-brain/RULES.md  (binding for every agent)
   b. AGENTS.md  (the eight invariants)
   c. sih-26-finale-brain/docs/start-here.md
   d. the newest file in sih-26-finale-brain/changelog/
   e. the newest file in project-updates/
   f. steps/README.md and steps/STATUS.md (the loop, and where we are)

2. Run from the workspace root:
   python3 sync_vault.py --check
   Report these four numbers: Notes indexed, Broken wikilinks, Orphan notes, Frontmatter missing.
   If Broken, Orphans or Frontmatter is not 0: STOP and tell me.

3. Run:
   cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q
   Report the exact count (for example "15 passed"). Never write "tests pass" without the number.

4. Rules for the whole session:
   - sih-26-finale-brain/ is the source of truth. You may read any note in it.
   - Do NOT edit anything inside sih-26-finale-brain/ unless your step prompt names that note.
     If a step does name one: keep the YAML frontmatter from RULES.md §2 (set last_agent_edit: antigravity-ag-N),
     use [[wikilinks]] only, never link to files outside the vault, append a new section instead of overwriting,
     write sih-26-finale-brain/changelog/YYYY-MM-DD-antigravity-ag-N-<short-desc>.md,
     then re-run sync_vault.py --check (it must be 0 / 0 / 0).
   - Inside mine-sim/, files/11-interface-contracts-v1.md wins over everything.
     Inside scenario-lab/ and renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md wins.
   - Only edit the files your step lists. Other AG windows are editing other files in this same folder at the same time.
   - Do NOT run git commit, git push, git stash, git checkout or git reset. Claude commits after review.

5. Reply with exactly:
   CONNECTED — AG-N
   Vault: <notes> notes, <broken> broken, <orphans> orphans, <frontmatter> frontmatter
   Pytest: <count>
   Newest changelog: <filename>
   Then wait for my step prompt.
```

---

**If you start a new chat in the same window** (for example the context got long), paste this block again first.

**To make it automatic (optional):** if your Antigravity version has a workspace **Rules** panel (Customizations → Rules), add a workspace rule containing items 4 and 5 from the block. Still paste the full block once per chat, because items 1–3 have to run every time.
