#!/usr/bin/env python3
"""Regenerate fixtures-real-{captures,runs,clusters,specs,funnel}.json from the debug-log corpus.

    python3 extension/tests/regen-fixtures.py            # verify only; exits 1 on drift
    python3 extension/tests/regen-fixtures.py --write     # rewrite the five fixtures
    SELENITE_LOGS=/path/to/logs python3 ... --write       # corpus somewhere else

WHY THIS FILE EXISTS. The four fixtures were built ad hoc and for months there was
no generator, so refreshing them meant re-deriving four different projections from
scratch -- and two of their fields are not straight copies of anything in the log
(see the TRAPS below). Both traps produce a fixture that still parses, still looks
plausible, and quietly encodes a different answer than production gave. That is the
exact failure mode the real-run suite exists to prevent, so the recovery procedure
belongs next to the fixtures rather than in someone's head.

THE CHECK THAT MAKES A REFRESH TRUSTWORTHY. Restricted to the keys already
committed, this script must reproduce each file BYTE FOR BYTE. If it does, the
projection was read correctly and the newly-added entries can be trusted on the
same evidence. If it does not, the projection was misread and NOTHING is written --
a mismatch is not something to paper over by loosening the comparison. Done right
the resulting diff is pure insertions, with no existing line touched. A MISMATCH
on any one file blocks --write for ALL of them, so a refresh never leaves the
five fixtures at different vintages of the projection rules.

This guard is for catching a misread, not for freezing the projection rules
themselves. A DELIBERATE rule change (like TRAP 3 below) is applied by hand to
the committed fixture as the minimal delta the new rule implies, and then
verify-only must reproduce that hand edit byte for byte before --write runs --
that reproduction is what confirms the hand edit was exactly the declared
change and nothing else.

THE CORPUS IS NOT IN THE REPO. It is the debug exports the extension writes,
~/Downloads/selenite-debug-r_*.json. Runs are keyed by id except in the specs
fixture, which is keyed by FILENAME STEM because two files on record share run id
1787851821352 (one is a "(1)" re-download) and keying by id silently drops one and
moves the spec census by one.
"""
import difflib
import json
import glob
import os
import sys

LOGS = os.path.expanduser(os.environ.get('SELENITE_LOGS', '~/Downloads'))
HERE = os.path.dirname(os.path.abspath(__file__))
WRITE = '--write' in sys.argv[1:]

# The verdict corpus (fixtures-real-runs and -clusters) is CURATED, and the
# curation is deliberate rather than drift: it covers the era from 1788191807035
# onward, PLUS four 3-variant runs backfilled later to give the reordering rule
# multi-cluster geometry to be checked against. The Aug 24-28 single-variant runs
# were never in it. Widening it is a real decision about what those suites claim,
# not a refresh -- so it is spelled out here instead of being inferred from dates.
BACKFILL = {'1787686041687', '1787687832083', '1787688438071', '1787689543404'}
ERA_FLOOR = 1788191807035

# RULE CHANGE, 2026-09-18. The era gate above was written when every log was an
# A/B run, so it read a run id and nothing else. Funnel Crawl runs land in the
# same id range and carry no verdict at all -- no captures, no perVariant, an
# empty visualDiff -- and four of them projected as runs whose every count was
# zero. That is not a clean run, it is an absent one, and the suite read it as
# the former: `allClean` and the control-duplicate identity both fired on runs
# that had compared nothing. The verdict corpus is about VERDICTS, so
# membership now also requires that the A/B comparison actually ran.
#
# Mode 2 is the direct statement of that. `captures`, `perVariant` and a
# non-skipped visualDiff are consequences of it and were measured to partition
# the 35 era-gated logs identically (31 / 4) -- the mode row is used because it
# says what is meant rather than what follows from it. The funnel walk itself is
# not lost: it projects into fixtures-real-funnel.json, which is about the agent
# loop rather than the diff.


def logs():
    """Every debug log on disk, as (filename stem, run id, parsed)."""
    for p in sorted(glob.glob(os.path.join(LOGS, 'selenite-debug-r_*.json'))):
        stem = os.path.basename(p)[len('selenite-debug-r_'):-len('.json')]
        with open(p) as fh:
            yield stem, stem.split(' ')[0], json.load(fh)


def in_verdict_corpus(rid, d=None):
    if not (rid in BACKFILL or int(rid) >= ERA_FLOOR):
        return False
    if d is None:
        return True
    return any(m.get('mode') == 2 for m in ((d.get('run') or {}).get('modes') or []))


# ── captures: every log that captured anything ────────────────────────────────
# The only fixture that can exercise capture PARITY, which is a property of the
# capture SET and invisible in the verdict projection. fullPage keys are copied
# only when the log carries them: viewportW and geometryPinned postdate the
# geometry pin, and inventing them for older runs would fabricate agreement
# between captures that were never compared on that axis.
#
# TRAP 3. A capture whose page load timed out records fullPage: null, not an
# absent key -- same shape distinction as TRAP 2 below. `(c.get('fullPage')
# or {})` collapses null to {}, and the width consumers (vdCaptureWidthMismatch,
# abCaptureWidths) treat {} as a normal-but-fieldless capture that PASSES their
# `c.fullPage &&` guard, while they treat null as absent and skip it -- so the
# fixture would blank out a run's whole width comparison where production
# reports one side's width cleanly. `error` is projected for the same reason
# even though no capture on record carries it yet: the consumers also gate on
# `!c.fullPage.error`, and a captured-but-errored fullPage that still carried
# dimensions would otherwise project as healthy.
def gen_captures():
    out = {}
    for _stem, rid, d in logs():
        caps = d.get('captures') or []
        if not caps:
            continue
        mfs = [v.get('matchedFraction') for v in ((d.get('visualDiff') or {}).get('perVariant') or [])]
        mfs = [m for m in mfs if m is not None]
        entry = {
            "captures": [{
                "fullPage": None if c.get('fullPage') is None else
                            {k: c['fullPage'][k]
                             for k in ('pageW', 'viewportH', 'geometryPinned', 'viewportW', 'error')
                             if k in c['fullPage']},
                "label": c.get('label'),
                "skipped": c.get('skipped'),
            } for c in caps],
            "worstMatchedFraction": min(mfs) if mfs else None,
        }
        if rid in out and out[rid] != entry:
            raise SystemExit('duplicate downloads of %s disagree -- resolve by hand' % rid)
        out[rid] = entry
    return out, dict(indent=0, sort_keys=True), True


# ── specs: every log carrying a designReference ───────────────────────────────
# Spec PROVENANCE only -- no spec text, just the fields the suppression decision
# reads. Keyed by filename stem; see the module docstring.
def gen_specs():
    out = {}
    for stem, _rid, d in logs():
        dr = d.get('designReference')
        if not isinstance(dr, dict):
            continue
        soc = dr.get('summaryOfChanges') or {}
        out[stem] = {
            "activeTicketKey": (dr.get('ticketContext') or {}).get('ticketKey'),
            "hasText": bool(soc.get('text')),
            "length": soc.get('length'),
            "present": soc.get('present'),
            "source": soc.get('source'),
            "specTicketKey": soc.get('ticketKey'),
        }
    return out, dict(indent=0, sort_keys=True), False


# ── runs: the verdict projection ──────────────────────────────────────────────
PV_FIELDS = ['controlDuplicate', 'diffMode', 'error', 'findings', 'gradingFailed',
             'label', 'matchedFraction', 'noVerdictCount', 'notServed', 'skipped']


def not_served_map(d):
    """TRAP 1. notServed is DERIVED and appears nowhere on the log's perVariant.

    The pipeline computes it from the CAPTURE's `variantVerified`, so a projection
    that copies perVariant fields straight across silently emits null for every
    run -- and null is falsy, so the two recorded not-served runs would quietly
    read as served and the fixture would assert the very false-PASS the notServed
    rung was added to close. Mirrors vdServedNoVariation(own, baselineVer):
    EITHER side being `contradicted` voids the pair, because a Control that did
    not serve Control is no baseline whatever the variant did.
    """
    caps = d.get('captures') or []
    vd = d.get('visualDiff') or {}
    base = next((c for c in caps if c.get('label') == vd.get('baselineLabel')), None)
    bver = (base or {}).get('variantVerified')
    res = {}
    for v in (vd.get('perVariant') or []):
        if v.get('skipped'):
            # The pipeline returns before assigning it, and vdVerdict's live()
            # gate means it is never read for a skipped variant. False keeps the
            # field's type uniform without asserting anything.
            res[v.get('label')] = False
            continue
        cap = next((c for c in caps if c.get('label') == v.get('label')), None)
        own = (cap or {}).get('variantVerified')
        res[v.get('label')] = bool((own and own.get('state') == 'contradicted')
                                   or (bver and bver.get('state') == 'contradicted'))
    return res


def gen_runs():
    out = {}
    for _stem, rid, d in logs():
        if not in_verdict_corpus(rid, d):
            continue
        vd = d.get('visualDiff') or {}
        ns = not_served_map(d)
        pv = []
        for v in (vd.get('perVariant') or []):
            o = {}
            for k in PV_FIELDS:
                if k == 'findings':
                    # Only the grade. The verdict never reads anything else, and
                    # carrying rects would make the fixture a second copy of the log.
                    o[k] = [{"classification": f.get('classification')}
                            for f in (v.get('findings') or [])]
                elif k == 'notServed':
                    o[k] = ns.get(v.get('label'), False)
                else:
                    o[k] = v.get(k) if k in v else None
            # TRAP 2. `requirements: null` is a RECORDED SHAPE, not an absent key --
            # two runs carry it, meaning grading ran and produced no set. Emitting
            # the key only for dicts drops it and is a byte mismatch.
            if 'requirements' in v:
                rq = v.get('requirements')
                o['requirements'] = None if not isinstance(rq, dict) else {
                    "absent": rq.get('absent'), "near": rq.get('near'),
                    "total": rq.get('total'), "verbatim": rq.get('verbatim'),
                    "items": [{"fragment": it.get('fragment'), "status": it.get('status'),
                               "text": it.get('required')} for it in (rq.get('items') or [])],
                }
            pv.append(o)
        out[rid] = {
            "baselineLabel": vd.get('baselineLabel'),
            "baselineWarning": vd.get('baselineWarning'),
            # Sliced to 90 chars: enough to identify the problem, short enough that
            # the fixture does not become a prose archive.
            "errorProblems": [(p.get('detail') or '')[:90]
                              for p in (d.get('problems') or []) if p.get('severity') == 'error'],
            "perVariant": pv,
            "sharedFindings": [{"classification": f.get('classification')}
                               for f in (vd.get('sharedFindings') or [])],
            "skipped": bool(vd.get('skipped')),
        }
    return out, dict(indent=0, sort_keys=True, ensure_ascii=False), True


# ── clusters: recorded shift geometry, one entry per variant ──────────────────
# Kept out of the verdict projection on purpose: you CANNOT re-run
# vdSuppressFindings from a debug log (it carries no candidate lists, only capped
# samples), so feeding the recorded clusters back through the predicate is the
# only way to check the reordering rule against real pages. Clusters are copied
# VERBATIM -- spanPx and contradictedBy included -- because the point is the
# geometry production actually recorded.
def gen_clusters():
    out = {}
    for _stem, rid, d in logs():
        if not in_verdict_corpus(rid, d):
            continue
        pv = ((d.get('visualDiff') or {}).get('perVariant')) or []
        for v in pv:
            sc = (v.get('diagnostics') or {}).get('shiftClusters')
            if not isinstance(sc, dict):
                continue
            vert = sc.get('vertical') or []
            # Single-variant runs are keyed bare; anything else carries its label.
            key = rid + ('#' + v['label'] if len(pv) > 1 else '')
            out[key] = {
                # Whether the log came from a build already running the rule, which
                # is what makes the axis-scoping assertions meaningful: an annotated
                # set must carry contradictedBy on every VERTICAL cluster and on no
                # horizontal one.
                "annotated": bool(vert) and all('contradictedBy' in c for c in vert),
                "generatedAt": d.get('generatedAt'),
                "shiftClusters": {"horizontal": sc.get('horizontal') or [], "vertical": vert},
                "suppressionAggregate": v.get('suppressionAggregate'),
            }
    return out, dict(indent=0, sort_keys=True), True


# Serialization differs per file and all three settings matter to byte-identity.
# `indent=0` is newline-separated with NO indentation -- not JSON.stringify(o,
# null, 0), which emits no newlines at all.
# ── funnel: every log carrying a Funnel Crawl walk ────────────────────────────
# The only fixture about the AGENT loop rather than the diff. It exists because
# a funnel failure is diagnosed from per-action evidence that appears nowhere
# else, and run 1789744771634 had to be diagnosed by solving a scale backwards
# from one step's output -- exactly the kind of hand-derivation a fixture ends.
#
# THE CORPUS IS ALMOST EMPTY, and that is the point of writing it down. Of 68
# logs on record, 4 ran funnel; 3 carry a `funnel` section at all (it postdates
# the others -- 1789677896589 ran funnel under an older popup.js and has no
# section, so it is absent here rather than projected as an empty walk); and
# exactly ONE (1789744771634) recorded any actions. This pins one real walk
# today. It is built now so walks join it as they land, not because it has
# coverage -- do not read a census off it the way the verdict fixtures allow.
#
# TRAP 4. `steps > 0` with an EMPTY action list is a real recorded shape, not a
# parse failure: it is the stale-service-worker signature popup.js detects
# (1789678299756, 1789742354610 -- a worker running a build older than the
# popup that exported the log). Projecting it is the only way that signature
# stays testable, so it must not be filtered out as uninteresting.
#
# TRAP 5. `coordConverted: null` is a THIRD state, distinct from false. null
# means the worker predates the field; false means the converter declined and
# the click point is unknown. A consumer writing `not a['coordConverted']`
# collapses them and turns every pre-fix action into a conversion failure, so
# the projection keeps `.get()`'s None rather than coercing to bool.
#
# TRAP 7. Several fields are `null` on every log written before the feature that
# produces them existed -- timing (`ms`/`modelMs`/`elapsedMs`), the native-control
# report (`hit.control`), the dropdown pick (`choice`) and the split mutation
# count (`structuralMutations`). null means the worker did not measure, NOT that
# the answer was zero/absent, and the difference is load-bearing twice over: the
# stop sentence sums modelMs/ms to say which half of a slow hop to fix, and
# fnDidSomething falls back to the undifferentiated total precisely when
# structuralMutations is null. `a.get()`'s None is kept rather than coerced.
#
# TRAP 6. `hit: null` (the probe could not run -- an injection-refusing page, or
# a navigation that destroyed the isolated world) is NOT the same as a hit whose
# `top` is null (nothingAtPoint). Flattening to `(a.get('hit') or {}).get('top')`
# merges them, and they behave differently: fnActionKey returns null for the
# former, which BREAKS a no-progress streak, while the latter extends it.
#
# Segment `geometry` is the LAST screenshot's, for the whole segment -- it is one
# object mutated in place per capture. It does NOT describe step 1. Only an
# action's own `geometry` is per-action, and only builds after the r_1789744771634
# fix carry one.
def gen_funnel():
    out = {}
    for _stem, rid, d in logs():
        f = d.get('funnel')
        if not isinstance(f, dict):
            continue
        entry = {
            "status": f.get('status'),
            "reachedEnd": f.get('reachedEnd'),
            "error": f.get('error'),
            "segments": [{
                "from": s.get('from'),
                "to": s.get('to'),
                "reached": s.get('reached'),
                "steps": s.get('steps'),
                "stopReason": s.get('stopReason'),
                "apiStopReason": s.get('apiStopReason'),
                # The detail behind an api-error/exception stop. `stopReason`
                # says WHICH class of failure; only this says which failure.
                "error": s.get('error'),
                "finalText": s.get('finalText'),
                # The sentence production ACTUALLY emitted. Frozen in the log, so
                # pinning it is stable across wording changes -- and it is the
                # only record that 1789744771634 concluded "not a targeting
                # problem" about a run whose coordinates were never converted.
                "summary": s.get('summary'),
                "geometry": s.get('geometry'),
                "elapsedMs": s.get('elapsedMs'),   # TRAP 7
                "actions": [{
                    "step": a.get('step'),
                    "action": a.get('action'),
                    # Read by fnCountsForProgress: an errored action is excluded
                    # from the no-progress streak entirely, so its absence here
                    # would make the fixture disagree with the predicate.
                    "error": a.get('error'),
                    "modelCoord": a.get('modelCoord'),
                    "cssCoord": a.get('cssCoord'),
                    "coordConverted": a.get('coordConverted'),   # TRAP 5
                    "coordReason": a.get('coordReason'),
                    "geometry": a.get('geometry'),
                    "modelMs": a.get('modelMs'),   # TRAP 7
                    "ms": a.get('ms'),             # TRAP 7
                    "choice": a.get('choice'),     # TRAP 7
                    "structuralMutations": a.get('structuralMutations'),   # TRAP 7
                    "outOfRange": a.get('outOfRange'),
                    "delivered": a.get('delivered'),
                    "deliveredTo": a.get('deliveredTo'),
                    "mutations": a.get('mutations'),
                    "hit": None if a.get('hit') is None else {   # TRAP 6
                        "top": (a.get('hit') or {}).get('top'),
                        # brief() reduces the element to '#id', so the tag is
                        # gone -- this is the only place a native <select> is
                        # distinguishable from a link downstream. TRAP 7.
                        "control": (a.get('hit') or {}).get('control'),
                        "interactive": (a.get('hit') or {}).get('interactive'),
                        # The OTHER viewport primitive, read in the page at click
                        # time. The scale comes from Page.getLayoutMetrics'
                        # cssVisualViewport; these say whether the two agree, and
                        # they are the only per-action record of that.
                        "innerW": (a.get('hit') or {}).get('innerW'),
                        "innerH": (a.get('hit') or {}).get('innerH'),
                        "isIframe": (a.get('hit') or {}).get('isIframe'),
                        "nothingAtPoint": (a.get('hit') or {}).get('nothingAtPoint'),
                        "coversPct": (a.get('hit') or {}).get('coversPct'),
                        "position": (a.get('hit') or {}).get('position'),
                    },
                    "page": None if a.get('page') is None else {
                        "url": (a.get('page') or {}).get('url'),
                        "textLen": (a.get('page') or {}).get('textLen'),
                    },
                } for a in (s.get('actions') or [])],   # TRAP 4: [] is a real shape
            } for s in (f.get('segments') or [])],
        }
        if rid in out and out[rid] != entry:
            raise SystemExit('duplicate downloads of %s disagree -- resolve by hand' % rid)
        out[rid] = entry
    return out, dict(indent=0, sort_keys=True, ensure_ascii=False), True


# Serialization differs per file and all three settings matter to byte-identity.
# `indent=0` is newline-separated with NO indentation -- not JSON.stringify(o,
# null, 0), which emits no newlines at all.
FIXTURES = [
    ('fixtures-real-captures.json', gen_captures),
    ('fixtures-real-clusters.json', gen_clusters),
    ('fixtures-real-funnel.json', gen_funnel),
    ('fixtures-real-runs.json', gen_runs),
    ('fixtures-real-specs.json', gen_specs),
]


def main():
    if not glob.glob(os.path.join(LOGS, 'selenite-debug-r_*.json')):
        sys.exit('no debug logs under %s -- set SELENITE_LOGS to the corpus' % LOGS)
    # A misread projection (`failed`) is an ERROR in both modes and must never
    # exit 0 -- a --write run that silently skipped a file is exactly how a stale
    # fixture survives a refresh. Pending additions (`stale`) are only a failure
    # in verify mode, because --write is what resolves them.
    #
    # Two passes on purpose: nothing is written until every file has been
    # checked, so a MISMATCH on the last file cannot leave the earlier ones
    # written and the rest not -- a refresh is all four fixtures or none of
    # them, never a mix of vintages.
    failed = False
    stale = False
    to_write = []
    for name, fn in FIXTURES:
        path = os.path.join(HERE, name)
        new, ser, nl = fn()
        with open(path, 'rb') as fh:
            raw = fh.read()
        cur = json.loads(raw)

        def blob(obj):
            return json.dumps(obj, **ser).encode('utf-8') + (b'\n' if nl else b'')

        kept = blob({k: v for k, v in new.items() if k in cur})
        added = sorted(set(new) - set(cur))
        dropped = sorted(set(cur) - set(new))
        if kept != raw:
            print('%-34s MISMATCH on existing keys -- projection misread, NOT written' % name)
            for line in difflib.unified_diff(
                    raw.decode('utf-8').splitlines(), kept.decode('utf-8').splitlines(),
                    fromfile='committed', tofile='reproduced', lineterm=''):
                print('    ' + line)
            failed = True
            continue
        if dropped:
            print('%-34s would DROP %d entr(ies) -- refusing: %s' % (name, len(dropped), dropped))
            failed = True
            continue
        print('%-34s reproduced  %d -> %d  (+%d)' % (name, len(cur), len(new), len(added)))
        for a in added:
            print('    + ' + a)
        if added:
            stale = True
        to_write.append((path, blob(new)))
    if failed:
        print('\nA projection no longer reproduces what is committed. Fix the projection --')
        print('do NOT edit the fixture by hand to match it, unless the fix itself is a')
        print('deliberate projection-rule change: then hand-apply the minimal delta the')
        print('new rule implies and let this check confirm it reproduces exactly that.')
        return 1
    if WRITE:
        for path, data in to_write:
            with open(path, 'wb') as fh:
                fh.write(data)
    if stale and not WRITE:
        print('\nFixtures are stale. Re-run with --write, then re-derive every pinned census')
        print('in real-runs.test.js from the refreshed data -- do NOT loosen an assertion to')
        print('make it pass.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
