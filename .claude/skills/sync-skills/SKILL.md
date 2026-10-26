---
name: sync-skills
description: Check whether the Claude skills that QA Pass and Email Check were ported from have changed in the Claude app, and port the changes into the extension. Run only when asked ("/sync-skills", "sync the skills", "did the QA Pass skill change?", "update Email Check from its skill"), never on your own initiative.
---

# Sync the skill-based Test Agent modes

QA Pass (`extension/qa-pass.js`) and Email Check (`extension/email-check.js`) are code ports of two Claude skills. `extension/tests/skill-sources.json` tracks each by mode (`qapass`, `emailcheck`), and the script finds the skill by its section headings. Nothing about an account is stored, in the repo or out of it (Will, 2026-10-27): no skill text (the skills hold client accounts, ids and addresses), no skill name (a name can carry a client's), no claude.ai id and no app account folder. The only local trace is `.git/skill-sync/`, one hash per line of the synced copy. Keep it that way: never save a skill's text, name or id anywhere, scratch copies included, and delete any test copy you make. Editing a skill on claude.ai changes nothing in Selenite. This command is the update, run on demand: `extension/tests/skill-sync.py` finds and shows the change, and you port it.

Arguments: `$ARGUMENTS`
- empty: check every skill and port what changed
- `status`: check only, then stop
- a mode (`qapass`, `emailcheck`) or a skill's name in the app: only that one
- `--skill <name>`: read that app skill instead of the one the headings match (name the mode too)
- `--from <path>`: read a downloaded `.skill` file instead of the app's copy (name the mode too)

## 1. Check

Run `python3 extension/tests/skill-sync.py` (add `status <mode>`, or `<mode> --from <path>`, as the arguments say). It exits 0 when everything is in sync and 1 when something changed.

- **In sync:** say so in one line, with the time the app last refreshed its skills (from the output), and stop.
- **Will says he edited a skill but it shows in sync:** the app hasn't refreshed its local copy yet. Ask him to restart the Claude app, or to download the skill from claude.ai and give you the file for `--from`.
- **Not found:** no skill in the app covers half of the mode's headings, or two cover them equally well. The output says which. A rename doesn't matter. Ask Will which skill it is and pass `--skill <name>` for this run (it stores nothing).

## 2. Read the change

Run `python3 extension/tests/skill-sync.py diff <mode>`. Every changed hunk is printed under the map entry of its section: `PORTED`, `PARTIAL`, `NOT PORTED` or `N/A`, with where the code lives and why. Read the mode's `decisions` in `extension/tests/skill-sources.json` too. They are Will's final scope answers.

Sort each hunk into one of four kinds:

| Kind | When | What you do |
|---|---|---|
| **Port** | Ported or partial section, and the change alters behaviour the mode implements | Change the code named in `where` |
| **Decided against** | A "not ported" section, or a sub-check the note lists as an `X.*` entry | Don't port; list it. If the change undercuts the recorded reason, ask Will |
| **New** | A section, sub-check or file the map has never seen ("no map entry", ADDED) | Ask Will: port it, or record it as not ported |
| **No effect** | Wording, examples, or Claude-in-Chrome mechanics with no counterpart (`n/a`) | One line in the summary |

Before editing anything, show Will a short table: section, the change in a few words, its kind, and what you'll do. Then port the **Port** rows unless one conflicts with a decision, and wait for his answers on the rest. If the change needs a new check, data source, permission or setting, recommend running it through the omnissiah pipeline instead of porting it inline.

## 3. Port

These rules still bind:

- Code decides every status. The model only explains (both modes).
- Don't reopen a decision through a port. A skill change that contradicts one is a question for Will.
- The repo is public. Skill text, real client copy, ids, URLs and ticket text never go into it. Committed fixtures stay synthetic (Email Check: `extension/tests/gen-email-fixtures.py`).
- A sub-check that becomes ported loses its `X.*` entry in `qpFixedNotTested` or `ecFixedNotTested`. One that stops being covered gains one.
- Markup goes into both `extension/popup.html` and `extension/sidepanel.html`.
- Tests: run every suite in `.github/workflows/run-tests.yml` with `jsc`, plus the mode's gate (`extension/tests/qapass-gate/`, `extension/tests/emailcheck-gate/`) when behaviour changed. For Email Check, also run the local real-data suite `.omnissiah/tests/email-check-real.test.js` when it exists.
- Check the memory notes on the two modes before you start.

## 4. Update the map, then accept

1. In `extension/tests/skill-sources.json`, update the `sections` entry of every section you touched (`status`, `where`, `note`), add entries for new `#`/`##` headings and files, and rename or delete entries whose headings changed. The notes describe Selenite's code. Don't quote the skill, and don't name a client: the skill's title is keyed `(title)` for that reason.
2. Run `python3 extension/tests/skill-sync.py accept <mode>`. It refuses while the map and the skill disagree. Accepting moves the baseline, so the next diff starts from this copy. Accept only once the port is done and the tests pass. If the only changes were **No effect** and Will has seen the table, you can accept straight away.

## 5. Report

Tell Will what changed in the skill, what you ported (files and tests), what you deliberately left out and why, and any open questions. Don't commit unless he asks. A commit bumps the patch version (manifest, README, CHANGELOG), following the repo's usual rules.
