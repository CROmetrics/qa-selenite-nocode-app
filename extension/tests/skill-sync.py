#!/usr/bin/env python3
"""Keep QA Pass and Email Check in step with the Claude skills they were ported from.

    python3 extension/tests/skill-sync.py                       # status of every tracked mode
    python3 extension/tests/skill-sync.py status qapass         # one mode (or the skill's name)
    python3 extension/tests/skill-sync.py diff qapass           # what changed since the last sync, by section
    python3 extension/tests/skill-sync.py accept qapass         # record the current copy as synced
    ... --skill <name>                                          # read that skill, not the one the headings match
    ... --from ~/Downloads/<skill>.skill                        # a downloaded .skill (zip) or a folder
                                                                # instead of the Claude app's copy

ON COMMAND ONLY. Nothing calls this automatically and nothing here edits the extension. In
Claude Code, /sync-skills (.claude/skills/sync-skills/SKILL.md) runs it and ports the change.

WHY THIS FILE EXISTS. QA Pass (qa-pass.js) and Email Check (email-check.js) are ports of two
Claude skills. A port is code, not a copy of the skill's text, so an edit to the skill on
claude.ai changes nothing in Selenite. This script answers what a port needs: has the skill
changed since the mode was last synced, what changed, and which part of the mode each change
touches (or whether Will scoped that part out on purpose).

NO ACCOUNT INFORMATION IS STORED, by Will's rule (2026-10-27). The skills hold client accounts,
ids and addresses, and the app's records hold claude.ai account ids. So nothing here keeps a
skill's text, its name, its claude.ai id or the app's org/account folders, in the repo or out
of it. What is kept:
  - skill-sources.json (committed): per mode, the hash of the synced copy, its claude.ai save
    time, Will's scope decisions and the section map (headings, and notes about Selenite's
    code). The skill's title is keyed "(title)", because a title can name a client.
  - .git/skill-sync/<mode>/<hash>.json (local, never committed, shared by every worktree): a
    fingerprint of the synced copy, one 16-hex-digit hash per line plus the heading each line
    sits under. It is what lets `diff` show which lines are new; a removed line shows as a count,
    because its text is not kept anywhere.
A skill is found by its section headings instead of by a stored name or id: the app skill whose
headings cover the most of the mode's map wins (a copy equal to the synced one wins outright).
--skill <name> overrides the match for one run, and stores nothing.

WHERE THE SKILLS COME FROM. The Claude desktop app keeps a local copy of every skill on the
account under
    ~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/*/*/skills/<name>/
with manifest.json beside skills/: `lastUpdated` (when the app last refreshed the folder, epoch
ms) and per skill its `name` and `updatedAt` (when it was last saved on claude.ai). An edit on
claude.ai reaches this folder only when the app refreshes it, so `status` prints both times.
When the app has not caught up, download the skill and pass --from.
SELENITE_SKILLS_DIR overrides the skills-plugin root.

THE SECTION MAP is what makes a diff actionable. Every heading of the skill has an entry saying
whether the mode ports it (and where) or deliberately does not (and why, usually one of Will's
scope answers). `diff` prints that entry above every changed hunk. `accept` refuses while the map
and the skill disagree: a heading with no entry, or an entry whose heading is gone. `#` and `##`
headings need their own entry; a `###` or deeper inherits its nearest `##`-or-deeper parent's
unless it has one. Lines before the first heading belong to "(frontmatter)", the first `#`
heading is "(title)", and a skill file other than SKILL.md is keyed by its path.
"""
import datetime
import difflib
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'skill-sources.json')
APP_ROOT = os.path.expanduser(os.environ.get(
    'SELENITE_SKILLS_DIR',
    '~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin'))
FRONTMATTER = '(frontmatter)'
TITLE = '(title)'
STATUSES = ('ported', 'partial', 'not ported', 'n/a')
MIN_MATCH = 0.5     # share of the map's headings an app skill must have to be taken for the mode's


def fail(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def utc(stamp):
    """An ISO string or epoch ms as 'YYYY-MM-DD HH:MM UTC'; None stays None."""
    if stamp is None:
        return None
    if isinstance(stamp, (int, float)):
        d = datetime.datetime.fromtimestamp(stamp / 1000, datetime.timezone.utc)
    else:
        d = datetime.datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
    return d.strftime('%Y-%m-%d %H:%M UTC')


def line_hash(line):
    return hashlib.sha256(line.encode('utf-8')).hexdigest()[:16]


# ── Reading a skill ─────────────────────────────────────────────────────────

def skip_name(rel):
    return any(p.startswith('.') or p == '__MACOSX' for p in rel.split('/'))


def read_tree_dir(path):
    files = {}
    for root, dirs, names in os.walk(path):
        dirs[:] = sorted(d for d in dirs if not skip_name(d))
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), path).replace(os.sep, '/')
            if not skip_name(rel):
                with open(os.path.join(root, n), 'rb') as f:
                    files[rel] = f.read()
    return files


def read_tree_zip(path):
    """(files, the SKILL.md entry's time) of a .skill download: a zip with one top folder
    (<name>/SKILL.md), read in memory, never extracted. Both downloads on record stamp SKILL.md
    with the skill's claude.ai updatedAt in UTC, to the minute."""
    with zipfile.ZipFile(path) as z:
        entries = [i for i in z.infolist() if not i.is_dir() and not skip_name(i.filename)]
        tops = {i.filename.split('/')[0] for i in entries}
        strip = len(tops) == 1 and all('/' in i.filename for i in entries)
        files, stamp = {}, None
        for i in entries:
            rel = i.filename.split('/', 1)[1] if strip else i.filename
            files[rel] = z.read(i)
            if rel == 'SKILL.md':
                stamp = '%04d-%02d-%02dT%02d:%02d:%02dZ' % i.date_time
        return files, stamp


def tree_hash(files):
    h = hashlib.sha256()
    for rel in sorted(files):
        h.update(rel.encode() + b'\0' + hashlib.sha256(files[rel]).hexdigest().encode() + b'\n')
    return h.hexdigest()


def text_of(files, rel='SKILL.md'):
    return files.get(rel, b'').decode('utf-8', 'replace')


def app_skills():
    """Every skill the app's manifests list, newest copy per name:
    [{name, updatedAt, refreshed, files, hash}]. Read on each run, never stored."""
    best = {}
    for man in glob.glob(os.path.join(APP_ROOT, '*', '*', 'manifest.json')):
        try:
            with open(man) as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        for s in m.get('skills', []):
            name = str(s.get('name'))
            folder = os.path.join(os.path.dirname(man), 'skills', name)
            if not os.path.isfile(os.path.join(folder, 'SKILL.md')):
                continue
            cur = best.get(name)
            if cur is None or (s.get('updatedAt') or '') > (cur['updatedAt'] or ''):
                best[name] = {'name': name, 'updatedAt': s.get('updatedAt'), 'refreshed': m.get('lastUpdated'),
                              'folder': folder}
    out = []
    for s in best.values():
        files = read_tree_dir(s.pop('folder'))
        out.append(dict(s, files=files, hash=tree_hash(files)))
    return out


def match_score(entry, files):
    """(headings of the map found in this copy, headings in the map), title and frontmatter aside."""
    want = [k for k in entry.get('sections', {}) if k not in (FRONTMATTER, TITLE) and '/' not in k]
    have = {k for k, _, _ in parse_sections(text_of(files))[1]}
    return len([k for k in want if k in have]), len(want)


def find_app_copy(entry, skill_name):
    """The app skill a mode was ported from, with how it was matched; (None, reason) if none."""
    skills = app_skills()
    if skill_name:
        s = next((s for s in skills if s['name'] == skill_name), None)
        return (dict(s, how='named on the command line'), None) if s else (None, 'no skill named "%s" in the app' % skill_name)
    synced = (entry.get('synced') or {}).get('hash')
    same = [s for s in skills if s['hash'] == synced]
    if same:
        return dict(same[0], how='the same copy as the synced one'), None
    scored = sorted(((match_score(entry, s['files']), s) for s in skills), key=lambda x: -x[0][0])
    if not scored or not scored[0][0][1]:
        return None, 'the app has no skills, or the map has no headings'
    (hit, total), s = scored[0]
    runner = scored[1][0][0] if len(scored) > 1 else -1
    if hit / total < MIN_MATCH:
        return None, 'no skill has half of the map\'s %d headings (best: "%s", %d)' % (total, s['name'], hit)
    if runner == hit:
        return None, 'two skills match the map equally well ("%s" and "%s", %d of %d headings)' % (
            s['name'], scored[1][1]['name'], hit, total)
    return dict(s, how='matched by its headings: %d of %d' % (hit, total)), None


def load_current(entry, from_path, skill_name):
    """The current copy, or (None, reason)."""
    if from_path:
        p = os.path.expanduser(from_path)
        if os.path.isdir(p):
            files, stamp, origin = read_tree_dir(p), None, 'a folder'
        elif zipfile.is_zipfile(p):
            (files, stamp), origin = read_tree_zip(p), 'a downloaded .skill file'
        else:
            fail('--from: %s is neither a folder nor a .skill (zip) file' % p)
        if 'SKILL.md' not in files:
            fail('--from: no SKILL.md in %s' % p)
        return {'files': files, 'hash': tree_hash(files), 'updatedAt': stamp, 'refreshed': None,
                'name': os.path.basename(p.rstrip('/')), 'origin': origin, 'how': None}, None
    app, why = find_app_copy(entry, skill_name)
    if not app:
        return None, why
    return dict(app, origin='Claude app'), None


def not_found(why):
    return ('Not found in the Claude app\'s skills folder (%s): %s.\n'
            '  Pass --skill <name> to name the skill, or --from <file.skill> to read a download.' % (APP_ROOT, why))


# ── Fingerprints ────────────────────────────────────────────────────────────

def fingerprint_root():
    try:
        out = subprocess.run(['git', '-C', HERE, 'rev-parse', '--git-common-dir'],
                             capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        fail('Not inside a git checkout: the fingerprints live in the git common dir.')
    return os.path.join(os.path.normpath(os.path.join(HERE, out)), 'skill-sync')


def fingerprint_path(key, h):
    return os.path.join(fingerprint_root(), key, h + '.json')


def fingerprint(files):
    """Per file: one hash per line and the heading it sits under, plus each heading's level and
    parents. No line's text."""
    out = {}
    for rel, data in files.items():
        lines = data.decode('utf-8', 'replace').split('\n')
        if rel == 'SKILL.md':
            per_line, _ = parse_sections('\n'.join(lines))
            sections = {}
            for key, level, parents in per_line:
                sections[key] = [level, [list(p) for p in parents]]
            out[rel] = {'lines': [[line_hash(ln), key] for ln, (key, _, _) in zip(lines, per_line)],
                        'sections': sections}
        else:
            out[rel] = {'lines': [[line_hash(ln), rel] for ln in lines], 'sections': {rel: [0, []]}}
    return out


def read_fingerprint(key, h):
    p = fingerprint_path(key, h) if h else None
    if not p or not os.path.isfile(p):
        return None
    with open(p) as f:
        return json.load(f)


def write_fingerprint(key, files, h):
    p = fingerprint_path(key, h)
    if not os.path.isfile(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + '.tmp', 'w') as f:
            json.dump(fingerprint(files), f)
        os.rename(p + '.tmp', p)
    return p


# ── Sections ────────────────────────────────────────────────────────────────

def parse_sections(text):
    """[(key, level, [(level, key)] of its parents, nearest first)] per line, and the ordered
    list of headings [(key, level, line)].

    Headings inside fenced code blocks are not headings. The frontmatter and anything before the
    first heading belong to FRONTMATTER; the first # heading is TITLE."""
    lines = text.split('\n')
    per_line, heads = [], []
    stack = []          # [(level, key)] of the enclosing headings
    fence = None
    titled = False
    in_front = bool(lines) and lines[0].strip() == '---'
    for i, line in enumerate(lines):
        if in_front:
            per_line.append((FRONTMATTER, 0, []))
            if i > 0 and line.strip() == '---':
                in_front = False
            continue
        m = re.match(r'^\s*(`{3,}|~{3,})', line)
        if m:
            fence = None if fence and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) else (fence or m.group(1))
        h = None if fence else re.match(r'^(#{1,6})\s+(.*?)\s*#*\s*$', line)
        if h:
            level, key = len(h.group(1)), h.group(2)
            if level == 1 and not titled:
                key, titled = TITLE, True
            while stack and stack[-1][0] >= level:
                stack.pop()
            parents = list(reversed(stack))
            stack.append((level, key))
            heads.append((key, level, i))
            per_line.append((key, level, parents))
        elif stack:
            per_line.append((stack[-1][1], stack[-1][0], list(reversed(stack[:-1]))))
        else:
            per_line.append((FRONTMATTER, 0, []))
    return per_line, heads


def section_hashes(lines_with_keys):
    out = {}
    for h, key in lines_with_keys:
        out.setdefault(key, []).append(h)
    return out


def map_entry(sections, key, level, parents):
    """The entry for a section, or for a ### or deeper, its nearest ## or deeper ancestor's
    (marked inherited). A # or ## without an entry has none: inheriting the title's would
    file a new top-level section under the skill's intro."""
    ok = lambda k: isinstance(sections.get(k), dict) and sections[k].get('status') in STATUSES
    if ok(key):
        return key, sections[key], False
    if level >= 3:
        for p_level, p in parents:
            if p_level >= 2 and ok(p):
                return p, sections[p], True
    return key, None, False


def map_problems(files, entry):
    sections = entry.get('sections', {})
    probs, known = [], {FRONTMATTER}
    for key, val in sections.items():
        if not isinstance(val, dict) or val.get('status') not in STATUSES:
            probs.append('map entry "%s": status must be one of %s' % (key, ', '.join(STATUSES)))
    _, heads = parse_sections(text_of(files))
    seen = {}
    for key, level, line in heads:
        known.add(key)
        seen[key] = seen.get(key, 0) + 1
        if level <= 2 and key not in sections:
            probs.append('heading "%s" (SKILL.md line %d) has no map entry' % (key, line + 1))
    for key, n in seen.items():
        if n > 1:
            probs.append('heading "%s" appears %d times: the map cannot tell them apart' % (key, n))
    for rel in files:
        if rel != 'SKILL.md':
            known.add(rel)
            if rel not in sections:
                probs.append('file "%s" has no map entry' % rel)
    for key in sections:
        if key not in known:
            probs.append('map entry "%s" names no heading or file in this copy (renamed or removed?)' % key)
    return probs


def describe(key, val, inherited):
    if val is None:
        return ['  ┆ NO MAP ENTRY: decide whether the mode ports this, then add one']
    out = ['  ┆ %s%s' % (val['status'].upper(), ' (from "%s")' % key if inherited else '')]
    for field in ('where', 'note'):
        if val.get(field):
            out.append('  ┆ %s: %s' % (field, val[field]))
    return out


# ── Commands ────────────────────────────────────────────────────────────────

def load_sources():
    with open(SOURCES) as f:
        return json.load(f)


def save_sources(data):
    with open(SOURCES, 'w') as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def pick(data, args, skill_name):
    """[(mode key, skill name or None)]. An argument that is not a mode is an app skill's name:
    it goes to the mode whose map that skill's headings cover best."""
    if not args:
        return [(k, skill_name) for k in data]
    out, skills = [], None
    for a in args:
        if a in data:
            out.append((a, skill_name))
            continue
        skills = skills if skills is not None else app_skills()
        s = next((s for s in skills if s['name'] == a), None)
        if s is None:
            fail('"%s" is neither a tracked mode (%s) nor a skill in the app' % (a, ', '.join(data)))
        hit, k = max((match_score(e, s['files'])[0] / max(1, match_score(e, s['files'])[1]), k) for k, e in data.items())
        if hit < MIN_MATCH:
            fail('the skill "%s" matches no tracked mode\'s section map' % a)
        out.append((k, a))
    return out


def cmd_status(data, args, from_path, skill_name):
    worst = 0
    for key, name in pick(data, args, skill_name):
        e, synced = data[key], data[key].get('synced') or {}
        cur, why = load_current(e, from_path, name)
        if cur is None:
            print('%s  →  %s\n  NOT FOUND. %s\n' % (key, e.get('mode', '?'), not_found(why)))
            worst = max(worst, 2)
            continue
        print('%s  →  %s, from the skill "%s"%s' % (key, e.get('mode', '?'), cur['name'],
                                                     ' (%s)' % cur['how'] if cur['how'] else ''))
        if cur['origin'] == 'Claude app':
            print('  app copy:  saved on claude.ai %s; the app last refreshed its skills %s'
                  % (utc(cur['updatedAt']) or 'at an unknown time', utc(cur['refreshed']) or 'at an unknown time'))
        else:
            print('  copy from: %s' % cur['origin'])
        print('  synced:    %s (accepted %s)' % (utc(synced.get('skillUpdatedAt')) or 'unknown', synced.get('acceptedOn', 'never')))
        if cur['hash'] == synced.get('hash'):
            print('  IN SYNC')
            if read_fingerprint(key, synced.get('hash')) is None:
                print('  (no fingerprint of it on this machine: run accept once so a later diff has a base)')
        else:
            print('  CHANGED since the last sync. Next: python3 extension/tests/skill-sync.py diff %s%s%s'
                  % (key, ' --skill ' + name if name else '', ' --from ' + from_path if from_path else ''))
            worst = max(worst, 1)
        probs = map_problems(cur['files'], e)
        if probs:
            print('  map: %d problem%s (diff lists them)' % (len(probs), '' if len(probs) == 1 else 's'))
        print()
    return worst


def print_file_diff(sections, rel, old, new_text, is_skill):
    """Hunks of one file: old is its fingerprint (or None when the file is new), new_text the
    current text (None when the file is gone). Removed lines have no text to show: a count."""
    old_lines = old['lines'] if old else []
    old_secs = old['sections'] if old else {}
    new_lines = new_text.split('\n') if new_text is not None else []
    if is_skill:
        new_per = parse_sections(new_text or '')[0] if new_text is not None else []
    else:
        new_per = [(rel, 0, [])] * len(new_lines)
    old_per = [(k, old_secs.get(k, [0, []])[0], [tuple(p) for p in old_secs.get(k, [0, []])[1]]) for _, k in old_lines]
    sm = difflib.SequenceMatcher(None, [h for h, _ in old_lines], [line_hash(ln) for ln in new_lines], autojunk=False)
    for group in sm.get_grouped_opcodes(3):
        # Old lines count too: a renamed heading shows under its old name, which the map
        # still has, and under its new one, which it does not yet.
        touched = []
        for tag, i1, i2, j1, j2 in group:
            if tag != 'equal':
                touched += new_per[j1:j2] + old_per[i1:i2]
        keys = []
        print('\n' + '─' * 78)
        for k, level, parents in touched:
            if k not in keys:
                keys.append(k)
                print('§ %s' % (k if is_skill else 'file ' + k))
                print('\n'.join(describe(*map_entry(sections, k, level, parents))))
        g0, g1 = group[0], group[-1]
        print('@@ -%d,%d +%d,%d @@' % (g0[1] + 1, g1[2] - g0[1], g0[3] + 1, g1[4] - g0[3]))
        for tag, i1, i2, j1, j2 in group:
            if tag == 'equal':
                for ln in new_lines[j1:j2]:
                    print('  ' + ln)
                continue
            if i2 > i1:
                print('- [%d line%s removed; the synced text is not kept]' % (i2 - i1, '' if i2 - i1 == 1 else 's'))
            for ln in new_lines[j1:j2]:
                print('+ ' + ln)


def cmd_diff(data, args, from_path, skill_name):
    for key, name in pick(data, args, skill_name):
        e = data[key]
        synced = e.get('synced') or {}
        cur, why = load_current(e, from_path, name)
        if cur is None:
            fail(key + ': ' + not_found(why))
        print('═' * 78)
        print('%s  →  %s, from the skill "%s"%s' % (key, e.get('mode', '?'), cur['name'],
                                                     ' (%s)' % cur['how'] if cur['how'] else ''))
        if cur['hash'] == synced.get('hash'):
            print('No change since the last sync.')
            continue
        base = read_fingerprint(key, synced.get('hash'))
        if base is None:
            print('No fingerprint of the synced copy (hash %s) on this machine, so there is nothing to'
                  % (synced.get('hash') or 'none')[:12])
            print('diff against. Read the whole skill and compare it with the map by hand.')
            base = {}
        sections = e.get('sections', {})
        print('synced copy: %s   current copy: %s'
              % (utc(synced.get('skillUpdatedAt')) or 'unknown', utc(cur['updatedAt']) or cur['origin']))

        new_t = text_of(cur['files'])
        if base:
            o = section_hashes(base['SKILL.md']['lines'])
            new_per = parse_sections(new_t)[0]
            n = section_hashes([(line_hash(ln), k) for ln, (k, _, _) in zip(new_t.split('\n'), new_per)])
            changed = [k for k in n if k in o and o[k] != n[k]]
            added = [k for k in n if k not in o]
            removed = [k for k in o if k not in n]
            print('\nSections: %d changed, %d added, %d removed, %d unchanged'
                  % (len(changed), len(added), len(removed), len([k for k in n if o.get(k) == n[k]])))
            where = {k: (lv, [tuple(p) for p in ps]) for k, (lv, ps) in base['SKILL.md']['sections'].items()}
            where.update({k: (lv, ps) for k, lv, ps in new_per})
            for label, keys in (('changed', changed), ('ADDED', added), ('REMOVED', removed)):
                for k in keys:
                    mkey, val, inh = map_entry(sections, k, *where[k])
                    tag = 'no map entry' if val is None else val['status'] + (' from "%s"' % mkey if inh else '')
                    print('  %-8s %s  [%s]' % (label, k, tag))
        probs = map_problems(cur['files'], e)
        if probs:
            print('\nMap problems (accept refuses until these are fixed):')
            for p in probs:
                print('  - ' + p)

        if base:
            print_file_diff(sections, 'SKILL.md', base['SKILL.md'], new_t, True)
            for rel in sorted((set(base) | set(cur['files'])) - {'SKILL.md'}):
                new_rel = text_of(cur['files'], rel) if rel in cur['files'] else None
                if rel in base and new_rel is not None and [h for h, _ in base[rel]['lines']] == \
                        [line_hash(ln) for ln in new_rel.split('\n')]:
                    continue
                print_file_diff(sections, rel, base.get(rel), new_rel, False)
        print()
    return 0


def cmd_accept(data, args, from_path, skill_name):
    if not args:
        fail('accept needs a mode: accept moves the baseline, so it is never done for all at once.')
    for key, name in pick(data, args, skill_name):
        e = data[key]
        cur, why = load_current(e, from_path, name)
        if cur is None:
            fail(key + ': ' + not_found(why))
        probs = map_problems(cur['files'], e)
        if probs:
            print('%s: NOT accepted. The section map does not match this copy of the skill:' % key)
            for p in probs:
                print('  - ' + p)
            print('Fix the "sections" entries in extension/tests/skill-sources.json, then accept again.')
            return 2
        path = write_fingerprint(key, cur['files'], cur['hash'])
        prev = (e.get('synced') or {}).get('hash')
        if prev == cur['hash']:
            print('%s: already synced to this copy; the map matches it. Fingerprint: %s' % (key, path))
            continue
        # The origin, never a file or skill name: a download is named after the skill, and a
        # skill's name can carry a client's.
        e['synced'] = {
            'hash': cur['hash'],
            'skillUpdatedAt': cur['updatedAt'],
            'acceptedOn': datetime.date.today().isoformat(),
            'from': cur['origin'],
        }
        save_sources(data)
        print('%s: accepted. %s → %s. Fingerprint: %s' % (key, (prev or 'none')[:12], cur['hash'][:12], path))
    return 0


def take_option(argv, flag):
    if flag not in argv:
        return argv, None
    i = argv.index(flag)
    if i + 1 >= len(argv):
        fail('%s needs a value' % flag)
    return argv[:i] + argv[i + 2:], argv[i + 1]


def main(argv):
    argv, from_path = take_option(argv, '--from')
    argv, skill_name = take_option(argv, '--skill')
    if any(a.startswith('-') for a in argv):
        fail(__doc__.split('\n\n')[1])
    cmd = argv[0] if argv and argv[0] in ('status', 'diff', 'accept') else 'status'
    args = argv[1:] if argv and argv[0] == cmd else argv
    if (from_path or skill_name) and len(args) != 1:
        fail('--from and --skill read one skill: name its mode')
    data = load_sources()
    return {'status': cmd_status, 'diff': cmd_diff, 'accept': cmd_accept}[cmd](data, args, from_path, skill_name)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
