// responsiveness.js — Test Agent Mode 5: text that is clipped or runs outside its margins, at each width, in every
// variation and on plain PROD. Desktop Chrome only: the viewport width is emulated (Emulation.setDeviceMetricsOverride,
// mobile:false), never a phone user agent or touch. Shared by background.js (importScripts) and both panels
// (<script src> before popup.js). Classic script, no module syntax.
//
// Naming: rs* / RS_* are defined only here. This file calls the shared kit (qa-kit.js) at CALL time only; nothing at
// the top level names another file's identifier, so the load order never matters at evaluation time.
//
// The engine never touches the browser: rsRun(io, rec, input) orchestrates through the `io` object of the kit
// (now, checkStop, sleep, debug, progress, load, state, facts, catalog, click, storageNames, viewport, scan, shot,
// compose) and records what it observed; rsDeriveRows(rec) computes every row from the record alone.
//
// Never optimizely_force_tracking and never _conv_eforce: every URL loaded here is built by qkBuildUrl, and a link
// that carries _conv_eforce is never loaded at all.
(function (g) {
  'use strict';

  const EXPORTS = {};

  // ── Constants ────────────────────────────────────────────────────────────
  const RS_RECORD_VERSION = 1;
  const RS_MODE = 'responsiveness';
  const RS_LABEL = 'Responsiveness';
  const RS_MAX_TARGETS = 6;
  const RS_MAX_ROWS_PER_WIDTH = 5;
  const RS_MAX_TILES_PER_TARGET = 6;
  const RS_MAX_TILES = 12;
  const RS_MAX_IGNORE = 40;
  const RS_MAX_WIDTHS = 30;
  // A literal copy of QA Pass's 16 built-in selectors (the suite pins it equal to QK_IGNORE_DEFAULTS).
  const RS_IGNORE_DEFAULTS = [
    'marquee', '[role="marquee"]', '[aria-roledescription="carousel" i]', '[aria-roledescription="slide" i]',
    '[class*="marquee" i]', '[class*="ticker" i]', '[class*="carousel" i]', '[class*="slider" i]', '[class*="swiper" i]',
    '[class*="slick" i]', '[class*="splide" i]', '[class*="glide" i]', '[class*="flickity" i]', '[class*="owl-" i]',
    '[class*="embla" i]', '[data-carousel]',
  ];
  const RS_TILE = {
    maxW: 480, cropH: 300, band: 22, sep: 2, quality: 0.7, prodBand: '#3b3b3b', varBand: '#9b1c1c', text: '#ffffff',
    mark: '#e00000', font: 'bold 13px sans-serif', placeholderH: 60, placeholderFill: '#dddddd',
  };
  const RS_COLUMNS = [
    { key: 'check', label: 'Check' },
    { key: 'expected', label: 'Expected' },
    { key: 'observed', label: 'Observed' },
    { key: 'verdict', label: 'Verdict' },
    { key: 'evidence', label: 'Evidence' },
    { key: 'width', label: 'Width' },
    { key: 'variant', label: 'Variant' },
    { key: 'selector', label: 'Element selector' },
    { key: 'gapPx', label: 'Gap px' },
    { key: 'alsoOnProd', label: 'Also on PROD' },
    { key: 'severity', label: 'Severity' },
    { key: 'tile', label: 'Tile' },
  ];
  const RS_MIN_GAP = 2;

  Object.assign(EXPORTS, {
    RS_RECORD_VERSION, RS_MODE, RS_LABEL, RS_MAX_TARGETS, RS_MAX_ROWS_PER_WIDTH, RS_MAX_TILES_PER_TARGET, RS_MAX_TILES,
    RS_MAX_IGNORE, RS_IGNORE_DEFAULTS, RS_TILE, RS_COLUMNS,
  });

  // ── Panel: inputs ────────────────────────────────────────────────────────
  function rsClean(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }
  function rsLabelOf(raw, i) {
    const s = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return s || ('v' + i);
  }
  function rsUniqueLabels(list) {
    const seen = {};
    return list.map(function (t, i) {
      let label = rsLabelOf(t.label, i);
      let n = 2;
      const base = label;
      while (seen[label]) { label = base + '-' + n; n++; }
      seen[label] = true;
      return Object.assign({}, t, { label: label });
    });
  }
  // One variation per line: `label url` or a bare url (labelled v<i>). At most `max` (default RS_MAX_TARGETS).
  function rsParseTargets(text, max) {
    const cap = max == null ? RS_MAX_TARGETS : max;
    const out = [];
    String(text == null ? '' : text).split('\n').forEach(function (line) {
      const t = line.trim();
      if (!t || out.length >= cap) return;
      const m = /https?:\/\/\S+/i.exec(t);
      let url, label;
      if (m) { url = m[0]; label = t.slice(0, m.index).trim(); } else {
        const toks = t.split(/\s+/);
        url = toks[toks.length - 1];
        label = toks.length > 1 ? toks[0] : '';
      }
      url = qkAbsUrl(url);
      if (!url) return;
      out.push({ label: label, url: url.slice(0, 2000) });
    });
    return rsUniqueLabels(out).map(function (t, i) { return { label: t.label || ('v' + i), url: t.url }; });
  }
  function rsTargetOf(t) {
    return { label: t.label, url: t.url, convForced: qkTrackingFlags(t.url).indexOf('_conv_eforce') >= 0 };
  }
  function rsControlUrl(ctx) {
    const l = qkControlLink(ctx);
    return l && l.url ? l.url : '';
  }
  function rsTicketTargets(ctx) {
    const links = ((ctx && ctx.previewLinks) || []).filter(function (l) { return l && l.url; });
    return rsUniqueLabels(links.map(function (l, i) { return { label: l.id != null ? l.id : 'v' + i, url: qkAbsUrl(l.url) }; }));
  }
  function rsTicketKeys(ctx) {
    return qkCleanPatterns((ctx && Array.isArray(ctx.storedStateKeys)) ? ctx.storedStateKeys : []);
  }
  function rsSameList(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function rsIgnoreOf(list) {
    return (Array.isArray(list) ? list : []).map(function (s) { return String(s == null ? '' : s).trim().slice(0, 200); })
      .filter(Boolean).filter(function (s, i, a) { return a.indexOf(s) === i; }).slice(0, RS_MAX_IGNORE);
  }

  function rsBuildInput(ctx, values) {
    values = values || {};
    const sources = {};
    // targets
    let targets = rsParseTargets(values.targets, 1000);
    if (targets.length) sources.targets = 'typed'; else {
      targets = rsTicketTargets(ctx);
      sources.targets = targets.length ? 'ticket' : 'none';
    }
    if (!targets.length) {
      return { ok: false, error: 'Responsiveness needs at least one variation link: set the ticket\'s preview links in Initialize or type them above.' };
    }
    if (targets.length > RS_MAX_TARGETS) {
      return { ok: false, error: 'Responsiveness sweeps at most ' + RS_MAX_TARGETS + ' variation links; ' + targets.length + ' were given. Type the ones to test in the Variation links field.' };
    }
    // PROD
    let prodUrl = rsClean(values.prod, 2000);
    if (prodUrl) { prodUrl = qkAbsUrl(prodUrl); sources.prodUrl = 'typed'; } else {
      const itw = ctx && ctx.itwLink ? qkAbsUrl(ctx.itwLink) : '';
      const base = itw || rsControlUrl(ctx);
      prodUrl = base ? qkProdUrl(qkAbsUrl(base)) : '';
      sources.prodUrl = prodUrl ? 'derived' : 'none';
    }
    // experiment id
    let experimentId = rsClean(values.exp, 40);
    if (experimentId) sources.experimentId = 'typed'; else if (ctx && ctx.experimentId) { experimentId = rsClean(ctx.experimentId, 40); sources.experimentId = 'ticket'; } else sources.experimentId = 'none';
    // stored-state keys (A9)
    const typedKeys = qkLines(values.keys);
    let storedKeys;
    if (typedKeys.length) {
      for (let i = 0; i < typedKeys.length; i++) {
        if (!qkCleanPatterns([typedKeys[i]]).length) {
          return { ok: false, error: 'Stored keys: "' + typedKeys[i] + '" is too broad: give exact names, or at least 3 characters before the *.' };
        }
      }
      storedKeys = qkCleanPatterns(typedKeys);
      sources.storedKeys = 'typed';
    } else {
      storedKeys = rsTicketKeys(ctx);
      sources.storedKeys = storedKeys.length ? 'ticket' : 'none';
    }
    // widths and ignore list: tool settings, always from the field
    const widths = qkParseWidths(values.widths);
    if (widths.length > RS_MAX_WIDTHS) return { ok: false, error: 'Sweep widths: at most ' + RS_MAX_WIDTHS + ' widths.' };
    sources.widths = rsClean(values.widths, 1000) ? 'typed' : 'derived';
    let ignore = RS_IGNORE_DEFAULTS.slice();
    sources.ignore = 'derived';
    if (typeof values.ignore === 'string') {
      ignore = rsIgnoreOf(qkLines(values.ignore));
      sources.ignore = rsSameList(ignore, RS_IGNORE_DEFAULTS) ? 'derived' : 'typed';
    }
    return {
      ok: true,
      input: {
        ticketKey: ctx && ctx.ticketKey ? rsClean(ctx.ticketKey, 60) : null,
        experimentId: experimentId || null,
        targets: targets.map(rsTargetOf),
        prodUrl: prodUrl || '',
        widths: widths,
        ignore: ignore,
        storedKeys: storedKeys,
        sources: sources,
      },
    };
  }

  function rsCtxLine(ctx) {
    if (!ctx) return 'No active ticket context: the inputs come from the fields above.';
    const links = ((ctx.previewLinks) || []).filter(function (l) { return l && l.url; }).length;
    return 'Ticket ' + qkMaskOutput(ctx.ticketKey || 'none') + ' · ' + links + ' preview link(s) · ITW link ' + (ctx.itwLink ? 'yes' : 'no')
      + ' · experiment ' + qkMaskOutput(ctx.experimentId || 'not stated');
  }
  function rsInputLine(input) {
    input = input || {};
    const s = input.sources || {};
    return 'Inputs: ' + (input.targets || []).length + ' variation link(s) (' + (s.targets || 'none') + '), PROD ' + (s.prodUrl || 'none')
      + ', experiment ' + (s.experimentId || 'none') + ', ' + (input.widths || []).length + ' width(s) (' + (s.widths || 'derived') + '), ignore list '
      + (input.ignore || []).length + ' selector(s) (' + (s.ignore || 'derived') + '), stored keys ' + (input.storedKeys || []).length + ' (' + (s.storedKeys || 'none') + ')';
  }

  const RS_PANEL = {
    mode: RS_MODE,
    label: RS_LABEL,
    prefix: 'rs',
    action: 'runResponsiveness',
    version: RS_RECORD_VERSION,
    columns: RS_COLUMNS,
    overridesKey: 'rsOverrides',
    settingsKey: 'rsSettings',
    lastRunKey: 'rsLastRun',
    debugLastKey: 'rsDebugLast',
    csvBase: 'responsiveness',
    fields: [
      {
        key: 'targets', id: 'rs-targets', kind: 'lines', scope: 'ticket',
        ph: function (ctx) {
          return rsTicketTargets(ctx).map(function (t) { return t.label + ' ' + t.url; }).join('\n');
        },
      },
      {
        key: 'prod', id: 'rs-prod', kind: 'text', scope: 'ticket',
        ph: function (ctx) {
          const itw = ctx && ctx.itwLink ? qkAbsUrl(ctx.itwLink) : '';
          const base = itw || rsControlUrl(ctx);
          return base ? qkProdUrl(qkAbsUrl(base)) : '';
        },
      },
      { key: 'exp', id: 'rs-exp', kind: 'text', scope: 'ticket', ph: function (ctx) { return ctx && ctx.experimentId ? String(ctx.experimentId) : ''; } },
      { key: 'keys', id: 'rs-keys', kind: 'lines', scope: 'ticket', ph: function (ctx) { return rsTicketKeys(ctx).join('\n'); } },
      { key: 'widths', id: 'rs-widths', kind: 'text', scope: 'global', dflt: '300,320,340,360,375,390,402,412,430,480,600,768,820,1024,1280,1440,1920,2080' },
      { key: 'ignore', id: 'rs-ignore', kind: 'selectors', scope: 'global', dflt: RS_IGNORE_DEFAULTS.join('\n') },
    ],
    buildInput: rsBuildInput,
    ctxLine: rsCtxLine,
    inputLine: rsInputLine,
  };

  Object.assign(EXPORTS, { rsParseTargets, rsBuildInput, rsCtxLine, rsInputLine, RS_PANEL });

  // ── Engine: input, record ────────────────────────────────────────────────
  function rsSanitizeInput(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const targets = rsUniqueLabels((Array.isArray(raw.targets) ? raw.targets : []).filter(function (t) { return t && t.url; })
      .slice(0, RS_MAX_TARGETS).map(function (t) { return { label: t.label, url: qkAbsUrl(rsClean(t.url, 2000)) }; })).map(rsTargetOf);
    const src = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
    const okSrc = ['typed', 'ticket', 'derived', 'none'];
    const sources = {};
    ['targets', 'prodUrl', 'experimentId', 'storedKeys', 'widths', 'ignore'].forEach(function (k) { sources[k] = okSrc.indexOf(src[k]) >= 0 ? src[k] : 'none'; });
    return {
      ticketKey: raw.ticketKey ? rsClean(raw.ticketKey, 60) : null,
      experimentId: raw.experimentId ? rsClean(raw.experimentId, 40) : null,
      targets: targets,
      prodUrl: raw.prodUrl ? qkAbsUrl(rsClean(raw.prodUrl, 2000)) : '',
      widths: qkParseWidths((Array.isArray(raw.widths) ? raw.widths : []).join(',')).slice(0, RS_MAX_WIDTHS),
      ignore: Array.isArray(raw.ignore) ? rsIgnoreOf(raw.ignore) : RS_IGNORE_DEFAULTS.slice(),
      storedKeys: qkCleanPatterns(raw.storedKeys),
      sources: sources,
    };
  }
  function rsMaskInput(input) { return qkMaskDeep(input); }
  function rsNewRecord(input, now) {
    input = input || {};
    return {
      version: RS_RECORD_VERSION,
      mode: RS_MODE,
      ts: now,
      startedAt: now,
      finishedAt: null,
      stopped: false,
      halted: null,
      error: null,
      ticketKey: input.ticketKey ? qkMaskOutput(input.ticketKey) : null,
      input: rsMaskInput(input),
      plan: {
        widths: qkWidthOrder(input.widths || []),
        targets: (input.targets || []).map(function (t) {
          return { label: t.label, url: qkMaskOutput(qkPathOnly(t.url)), convForced: !!t.convForced, forcedIds: qkForcedIds(t.url) };
        }),
        prodMode: null,
        prodLiveIds: [],
      },
      loads: [],
      sweep: [],
      tiles: [],
      tilesCapped: null,
      rows: [],
    };
  }

  // ── Tiles: the pure layout ───────────────────────────────────────────────
  function rsClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rsMark(m, width) {
    if (m && m.rect && typeof m.rect.x === 'number') return m;
    return { found: false, rect: { x: 0, y: 0, w: 0, h: 0 }, vw: width, vh: RS_TILE.cropH };
  }
  // Appendix A.8. Input {width, target, gapPx, side, text, prod: null | mark, variant: mark}. Returns {w, h, quality, ops}.
  function rsTileLayout(t) {
    const T = RS_TILE;
    const width = t.width;
    const vm = rsMark(t.variant, width);
    const pm = t.prod ? rsMark(t.prod, width) : null;
    const side = t.side === 'left' ? 'left' : 'right';
    const gapPx = t.gapPx || 0;
    const cropW = Math.round(Math.min(vm.vw || width, T.maxW));
    const win = function (m) {
      const edgeX = side === 'left' ? m.rect.x : m.rect.x + m.rect.w;
      const cx = m.vw <= T.maxW ? 0 : rsClamp(Math.round(edgeX - cropW / 2), 0, m.vw - cropW);
      const ch = Math.min(m.vh, T.cropH);
      const cy = rsClamp(Math.round(m.rect.y + m.rect.h / 2 - ch / 2), 0, m.vh - ch);
      return { cx: cx, cy: cy, ch: ch, edgeX: edgeX };
    };
    const V = win(vm);
    const chV = V.ch;
    let P = null, hp = T.placeholderH;
    if (pm) {
      if (pm.found) P = win(pm); else {
        const chP = Math.min(pm.vh, T.cropH);
        P = { cx: rsClamp(V.cx, 0, Math.max(0, pm.vw - cropW)), cy: rsClamp(V.cy, 0, Math.max(0, pm.vh - chP)), ch: chP, edgeX: V.edgeX };
      }
      hp = P.ch;
    }
    const w = cropW;
    const yV = T.band + hp + T.sep;
    const h = yV + T.band + chV;
    const R = Math.round;
    const ops = [];
    ops.push({ op: 'rect', x: 0, y: 0, w: w, h: h, fill: '#ffffff' });
    ops.push({ op: 'rect', x: 0, y: 0, w: w, h: T.band, fill: T.prodBand });
    ops.push({ op: 'text', x: 6, y: 16, text: 'PROD · ' + width + ' px' + (pm ? (pm.found ? '' : ' · same text not found, same position') : ' · not captured'), fill: T.text, font: T.font });
    if (pm) {
      ops.push({ op: 'image', src: 'prod', sx: R(P.cx), sy: R(P.cy), sw: w, sh: R(hp), dx: 0, dy: T.band, dw: w, dh: R(hp) });
    } else {
      ops.push({ op: 'rect', x: 0, y: T.band, w: w, h: hp, fill: T.placeholderFill });
      ops.push({ op: 'text', x: 6, y: T.band + Math.round(hp / 2) + 4, text: 'PROD was not captured at ' + width + ' px', fill: '#333333', font: T.font });
    }
    ops.push({ op: 'rect', x: 0, y: T.band + hp, w: w, h: T.sep, fill: '#000000' });
    ops.push({ op: 'rect', x: 0, y: yV, w: w, h: T.band, fill: T.varBand });
    ops.push({ op: 'text', x: 6, y: yV + 16, text: String(t.target) + ' · ' + width + ' px · gap ' + qkMinus(gapPx) + ' px', fill: T.text, font: T.font });
    ops.push({ op: 'image', src: 'variant', sx: R(V.cx), sy: R(V.cy), sw: w, sh: R(chV), dx: 0, dy: yV + T.band, dw: w, dh: R(chV) });
    const bx = Math.round((side === 'left' ? V.edgeX - gapPx : V.edgeX + gapPx) - V.cx);
    if (bx >= 0 && bx <= w) {
      ops.push({ op: 'line', x1: bx, y1: yV + T.band, x2: bx, y2: yV + T.band + R(chV), stroke: T.mark, width: 2 });
    }
    ops.push({
      op: 'text', x: R(rsClamp(V.edgeX - V.cx - 40, 2, w - 60)), y: yV + T.band + R(rsClamp(vm.rect.y - V.cy - 4, 14, chV - 4)),
      text: qkMinus(gapPx) + ' px', fill: T.mark, font: T.font,
    });
    return { w: w, h: Math.round(h), quality: T.quality, ops: ops };
  }

  // Why one failing (variation, width) has no tile: the cap that denied THAT width (tilesCapped.at), else it was never
  // captured (the shot failed, or the run ended first; the debug log says which). Never a cap another width hit (A25).
  function rsNoTileText(c, target, w) {
    const why = c && c.at ? c.at[target + '|' + w] : null;
    if (why === 'perTarget') return 'no tile (cap of ' + RS_MAX_TILES_PER_TARGET + ' per variation reached)';
    if (why === 'total') return 'no tile (cap of ' + RS_MAX_TILES + ' per run reached)';
    return 'no tile (not captured)';
  }
  function rsTilesCappedText(c) {
    if (!c) return '';
    const parts = [];
    Object.keys(c.perTarget || {}).forEach(function (k) {
      parts.push(k + ': ' + c.perTarget[k] + ' width(s) over the cap of ' + RS_MAX_TILES_PER_TARGET + ' per variation');
    });
    if (c.total) parts.push(c.total + ' width(s) over the cap of ' + RS_MAX_TILES + ' per run');
    return parts.length ? 'No tile for ' + parts.join('; ') + '.' : '';
  }
  function rsProdModeText(plan) {
    plan = plan || {};
    const n = (plan.widths || []).length;
    const nw = n === 1 ? '1 width' : n + ' widths';
    if (plan.prodMode === 'reload') return nw + ', reloaded once per width';
    if (plan.prodMode === 'resize') {
      const ids = plan.prodLiveIds || [];
      return nw + ', swept by resizing one load because ' + (ids.length ? 'PROD shows live experiment(s) ' + ids.join(', ') : 'the live experiments on PROD could not be read');
    }
    return '';
  }

  Object.assign(EXPORTS, { rsSanitizeInput, rsMaskInput, rsNewRecord, rsTileLayout, rsTilesCappedText, rsProdModeText });

  // ── Engine: the run ──────────────────────────────────────────────────────
  function rsScanOk(sc) { return !!sc && !sc.error; }
  function rsSortOffenders(sc) {
    return ((sc && sc.offenders) || []).map(function (o, i) { return { o: o, i: i }; })
      .sort(function (a, b) { return (a.o.gapPx - b.o.gapPx) || (a.i - b.i); }).map(function (x) { return x.o; });
  }
  function rsOverflow(sc) { return sc && sc.pageOverflowPx > RS_MIN_GAP ? sc.pageOverflowPx : 0; }
  function rsFailing(sc) { return rsScanOk(sc) && (((sc.offenderCount || 0) > 0 || (sc.offenders || []).length > 0) || rsOverflow(sc) > 0); }
  function rsScanLine(label, w, sc) {
    if (!sc || sc.error) return { level: 'error', text: label + ' @ ' + w + 'px: the clipping scan failed (' + qkMaskOutput(sc && sc.error) + ')' };
    const n = sc.offenderCount || (sc.offenders || []).length;
    const ig = sc.ignored || {};
    return {
      level: n || rsOverflow(sc) ? 'warn' : 'info',
      text: label + ' @ ' + w + 'px: ' + n + ' clipped text(s)' + (n ? ', worst ' + qkMinus(sc.worstGapPx || 0) + ' px' : '')
        + ', page overflow ' + (sc.pageOverflowPx || 0) + ' px · ignored: carousel ' + (ig.carousel || 0) + ', ellipsis ' + (ig.ellipsis || 0)
        + ', screen-reader ' + (ig.srOnly || 0) + ', off-canvas ' + (ig.offCanvas || 0),
    };
  }

  async function rsRun(io, rec, input) {
    const widths = qkWidthOrder(input.widths);
    const targets = input.targets || [];
    const shots = {};      // tile id -> {variant: {data, mark}}
    const prodShots = {};  // '<w>|<key>' -> {data, mark}
    const wanted = {};     // width -> [{key, text, y}]
    const perTarget = {};  // label -> tiles taken
    const appKeys = input.storedKeys;
    const dbg = function (level, text) { io.debug(level, text); };
    rec.plan.widths = widths;
    dbg('info', 'Plan: ' + targets.length + ' variation link(s) × ' + widths.length + ' width(s) in severity order (' + widths.join(', ') + '), then PROD ' + (input.prodUrl ? 'yes' : 'not given'));

    const capture = async function (t, w, entry, sc, raw) {
      const offs = rsSortOffenders(raw);
      const off = offs[0] || null;
      if (perTarget[t.label] >= RS_MAX_TILES_PER_TARGET) {
        rec.tilesCapped = rec.tilesCapped || { perTarget: {}, total: 0, at: {} };
        rec.tilesCapped.perTarget[t.label] = (rec.tilesCapped.perTarget[t.label] || 0) + 1;
        rec.tilesCapped.at[t.label + '|' + w] = 'perTarget';
        return;
      }
      if (rec.tiles.length >= RS_MAX_TILES) {
        rec.tilesCapped = rec.tilesCapped || { perTarget: {}, total: 0, at: {} };
        rec.tilesCapped.total++;
        rec.tilesCapped.at[t.label + '|' + w] = 'total';
        return;
      }
      const text = off ? off.text : '';
      const y = off && off.rect ? off.rect.y : 0;
      const r = await io.shot({ text: text, y: y });
      if (!r || r.error || !r.data) { dbg('warn', t.label + ' @ ' + w + 'px: no tile (' + qkMaskOutput((r && r.error) || 'no result') + ')'); return; }
      const id = 'T' + (rec.tiles.length + 1);
      rec.tiles.push({
        id: id, target: t.label, width: w, gapPx: off ? off.gapPx : -rsOverflow(raw), side: off && off.side === 'left' ? 'left' : 'right',
        text: qkMaskOutput(text), img: null,
      });
      shots[id] = { variant: r, key: qkOffenderKey(text) };
      perTarget[t.label] = (perTarget[t.label] || 0) + 1;
      (wanted[w] = wanted[w] || []).push({ key: qkOffenderKey(text), text: text, y: y });
      dbg('info', 'Tile ' + id + ' for ' + t.label + ' @ ' + w + 'px');
    };

    // ── variations
    for (let ti = 0; ti < targets.length; ti++) {
      const t = targets[ti];
      const forcedIds = qkForcedIds(t.url);
      await io.progress({ phase: 'variation', label: t.label, width: null });
      if (t.convForced) {
        dbg('warn', t.label + ': the link forces with _conv_eforce, which this mode never loads; not swept');
        widths.forEach(function (w) { rec.sweep.push({ target: t.label, role: 'variant', width: w, mode: 'reload', loadId: null, ok: false, loadError: null, served: null, skipped: 'conv-forced', scan: null }); });
        continue;
      }
      const url = qkBuildUrl(t.url);
      if (!url) {
        widths.forEach(function (w) { rec.sweep.push({ target: t.label, role: 'variant', width: w, mode: 'reload', loadId: null, ok: false, loadError: 'not a web address', served: null, skipped: 'no-address', scan: null }); });
        continue;
      }
      for (let wi = 0; wi < widths.length; wi++) {
        const w = widths[wi];
        io.checkStop();
        await io.progress({ phase: 'variation', label: t.label, width: w });
        const L = await qkLoadInto(io, rec, { role: 'variant', label: t.label, url: url, width: w, keepState: false, appKeys: appKeys });
        const entry = { target: t.label, role: 'variant', width: w, mode: 'reload', loadId: L.id, ok: !!L.ok, loadError: L.loadError || null, served: null, skipped: null, scan: null };
        rec.sweep.push(entry);
        if (!L.ok) continue;
        if (forcedIds.length) {
          const s = await io.state({ experimentId: input.experimentId, forcedIds: forcedIds });
          const sl = qkDebugStateLine(t.label + ' @ ' + w + 'px', s);
          dbg(sl.level, sl.text);
          entry.served = s && s.readable && s.platform === 'optimizely' ? s.servedForced : null;
          if (entry.served === false) {
            entry.skipped = 'not-served';
            for (let r = wi + 1; r < widths.length; r++) {
              rec.sweep.push({ target: t.label, role: 'variant', width: widths[r], mode: 'reload', loadId: null, ok: false, loadError: null, served: null, skipped: 'not-served', scan: null });
            }
            dbg('warn', t.label + ': the forced variation was not served; the rest of this link is blocked');
            break;
          }
        }
        let raw = await io.scan({ ignoreList: input.ignore });
        if (raw === null || raw === undefined) raw = { error: 'no result (the page script failed)' };
        entry.scan = qkMaskDeep(raw);
        const sl2 = rsScanLine(t.label, w, raw);
        dbg(sl2.level, sl2.text);
        if (raw.ignoreInvalid && raw.ignoreInvalid.length) dbg('warn', 'Ignore list: ' + raw.ignoreInvalid.length + ' entr(ies) were not valid selectors for the page and were dropped');
        if (rsScanOk(raw)) {
          rsSortOffenders(raw).slice(RS_MAX_ROWS_PER_WIDTH).forEach(function (o) {
            dbg('warn', t.label + ' @ ' + w + 'px: more clipped text "' + qkCut(o.text, 60) + '" ' + qkMinus(o.gapPx) + ' px');
          });
          if (rsFailing(raw)) await capture(t, w, entry, entry.scan, raw);
        }
      }
    }

    // ── PROD
    const prodUrl = input.prodUrl ? qkBuildUrl(input.prodUrl) : '';
    if (prodUrl && widths.length) {
      await io.progress({ phase: 'prod', label: 'PROD', width: null });
      const pushProd = function (w, mode, L, extra) {
        const e = Object.assign({ target: 'PROD', role: 'prod', width: w, mode: mode, loadId: L ? L.id : null, ok: !!(L && L.ok), loadError: L ? (L.loadError || null) : null, served: null, skipped: null, scan: null }, extra || {});
        rec.sweep.push(e);
        return e;
      };
      const prodScan = async function (w, entry, opts) {
        let raw = await io.scan(opts);
        if (raw === null || raw === undefined) raw = { error: 'no result (the page script failed)' };
        entry.scan = qkMaskDeep(raw);
        const sl = rsScanLine('PROD', w, raw);
        dbg(sl.level, sl.text);
        const list = wanted[w] || [];
        const done = {};
        for (let i = 0; i < list.length; i++) {
          if (done[list[i].key]) continue;
          done[list[i].key] = true;
          const r = await io.shot({ text: list[i].text, y: list[i].y });
          if (r && !r.error && r.data) prodShots[w + '|' + list[i].key] = r;
        }
      };
      const first = widths[0];
      io.checkStop();
      const L0 = await qkLoadInto(io, rec, { role: 'prod', label: 'PROD', url: prodUrl, width: first, keepState: false, appKeys: appKeys });
      if (!L0.ok) {
        pushProd(first, 'reload', L0);
        widths.slice(1).forEach(function (w) { pushProd(w, 'reload', null, { skipped: 'prod-load-failed' }); });
        dbg('warn', 'PROD did not load at ' + first + 'px; the other widths were not tried');
      } else {
        const census = await io.state({ experimentId: null, forcedIds: [] });
        const live = census && census.readable ? (census.activeIds || []).map(String) : null;
        const mode = live === null || live.length ? 'resize' : 'reload';
        rec.plan.prodMode = mode;
        rec.plan.prodLiveIds = live || [];
        dbg('info', 'PROD census: ' + (live === null ? 'could not be read' : live.length + ' live experiment(s)') + ' → ' + (mode === 'reload' ? 'one clean reload per width' : 'one load, resized per width'));
        const e0 = pushProd(first, mode, L0);
        await prodScan(first, e0, { ignoreList: input.ignore });
        for (let i = 1; i < widths.length; i++) {
          const w = widths[i];
          io.checkStop();
          if (mode === 'reload') {
            const L = await qkLoadInto(io, rec, { role: 'prod', label: 'PROD', url: prodUrl, width: w, keepState: false, appKeys: appKeys });
            const e = pushProd(w, 'reload', L);
            if (L.ok) await prodScan(w, e, { ignoreList: input.ignore });
          } else {
            await io.viewport(w);
            await io.sleep(QK_SETTLE.resizeWaitMs);
            const e = pushProd(w, 'resize', L0);
            await prodScan(w, e, { ignoreList: input.ignore, settle: { firstWaitMs: 0, pollMs: 250, maxPolls: 8, scroll: true, freeze: true } });
          }
        }
      }
    }

    // ── tiles
    for (let i = 0; i < rec.tiles.length; i++) {
      const tile = rec.tiles[i];
      io.checkStop();
      await io.progress({ phase: 'tiles', label: tile.id, width: tile.width });
      const sh = shots[tile.id];
      if (!sh) continue;
      const prod = prodShots[tile.width + '|' + sh.key] || null;
      const layout = rsTileLayout({
        width: tile.width, target: tile.target, gapPx: tile.gapPx, side: tile.side, text: tile.text,
        prod: prod ? rsMark(prod.mark, tile.width) : null, variant: rsMark(sh.variant.mark, tile.width),
      });
      const url = await io.compose(layout, { prod: prod ? prod.data : null, variant: sh.variant.data });
      tile.img = typeof url === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(url) ? url : null;
      if (!tile.img) dbg('warn', 'Tile ' + tile.id + ' could not be drawn');
    }
  }

  // ── Engine: rows ─────────────────────────────────────────────────────────
  function rsNoObservation(rec, why) {
    if (rec.halted) {
      return { status: 'blocked', evidence: 'Blocked: a bot check (' + (rec.halted.signal || 'challenge') + ') on ' + (rec.halted.path || '(no address)') + ' halted the run; it was never attempted.' };
    }
    if (rec.stopped) return { status: 'not-tested', evidence: 'Stopped: by the tester before this ran.' };
    if (rec.error) return { status: 'not-tested', evidence: 'Not run: the run ended on an error (' + qkMaskOutput(rec.error) + ').' };
    return { status: 'not-tested', evidence: 'Not run: ' + why };
  }
  function rsAlso(prodEntry, off) {
    if (!prodEntry || !rsScanOk(prodEntry.scan)) return 'unknown';
    const key = qkOffenderKey(off.text);
    const offs = prodEntry.scan.offenders || [];
    if (offs.some(function (o) { return qkOffenderKey(o.text) === key; })) return 'yes';
    if ((prodEntry.scan.offenderCount || 0) > offs.length) return 'unknown';
    return 'no';
  }
  function rsAlsoText(a, w, overflow) {
    if (a === 'yes') return 'also on PROD: yes — ' + (overflow ? 'PROD is also wider than the viewport at ' + w + ' px' : 'PROD clips the same text at ' + w + ' px') + ', still a defect';
    if (a === 'no') return 'also on PROD: no — new in this variation (regression)';
    return 'also on PROD: unknown — PROD was not measured at ' + w + ' px';
  }

  function rsDeriveRows(rec) {
    rec = rec || {};
    const plan = rec.plan || {};
    const input = rec.input || {};
    const sweep = Array.isArray(rec.sweep) ? rec.sweep : [];
    const tiles = Array.isArray(rec.tiles) ? rec.tiles : [];
    const widthsAsc = (plan.widths || []).slice().sort(function (a, b) { return a - b; });
    const rows = [];
    const entryOf = function (label, role, w) {
      return sweep.filter(function (e) { return e && e.target === label && e.role === role && e.width === w; })[0] || null;
    };
    const tileOf = function (label, w) {
      return tiles.filter(function (t) { return t && t.target === label && t.width === w; })[0] || null;
    };
    (plan.targets || []).forEach(function (t) {
      widthsAsc.forEach(function (w) {
        const e = entryOf(t.label, 'variant', w);
        const base = { step: t.label, emulated: true, extra: { width: w, variant: t.label, severity: qkSeverity(w) } };
        const loads = e && e.loadId ? [e.loadId] : [];
        const prodE = entryOf('PROD', 'prod', w);
        if (e && rsScanOk(e.scan) && !e.skipped) {
          const sc = e.scan;
          const offs = rsSortOffenders(sc);
          const total = Math.max(sc.offenderCount || 0, offs.length);
          const overflow = rsOverflow(sc);
          const tileRec = tileOf(t.label, w);
          const tile = tileRec && tileRec.img ? tileRec : null; // a row names a tile only when it has an image (A25)
          const tailFor = function () {
            if (tile) return '; tile ' + tile.id;
            return '; ' + (tileRec ? 'no tile (it was not drawn)' : rsNoTileText(rec.tilesCapped, t.label, w));
          };
          offs.slice(0, RS_MAX_ROWS_PER_WIDTH).forEach(function (o, i) {
            const a = rsAlso(prodE, o);
            const where = o.by === 'overflow' ? 'container ' + (o.clipBy || 'unknown') : 'viewport';
            rows.push(qkRow(Object.assign({}, base, {
              id: 'rs.' + t.label + '.' + w + '.' + (i + 1),
              check: '"' + qkCut(o.text, 40) + '" clipped',
              expected: 'text inside the viewport and inside its overflow:hidden container',
              observed: (o.side === 'left' ? 'left' : 'right') + ' edge ' + qkMinus(o.gapPx) + ' px past the ' + where,
              status: 'failed',
              evidence: 'element ' + (o.el || 'unknown') + '; ' + rsAlsoText(a, w, false) + tailFor(),
              loads: loads,
              tile: tile ? tile.id : null,
              extra: { width: w, variant: t.label, selector: o.el || '', gapPx: o.gapPx, alsoOnProd: a, severity: qkSeverity(w) },
            })));
          });
          if (total > RS_MAX_ROWS_PER_WIDTH) {
            const n = total - RS_MAX_ROWS_PER_WIDTH;
            rows.push(qkRow(Object.assign({}, base, {
              id: 'rs.' + t.label + '.' + w + '.more',
              check: n + ' more clipped text(s) at ' + w + ' px',
              expected: 'no clipped text',
              observed: 'the first ' + RS_MAX_ROWS_PER_WIDTH + ' are listed; ' + n + ' more',
              status: 'failed',
              evidence: 'the rest are in the debug log (first 25 per scan)',
              loads: loads,
              extra: { width: w, variant: t.label, severity: qkSeverity(w) },
            })));
          }
          if (overflow) {
            const pe = prodE && rsScanOk(prodE.scan) ? (rsOverflow(prodE.scan) ? 'yes' : 'no') : 'unknown';
            rows.push(qkRow(Object.assign({}, base, {
              id: 'rs.' + t.label + '.' + w + '.overflow',
              check: 'Page wider than the viewport',
              expected: 'page no wider than the viewport',
              observed: 'page is ' + overflow + ' px wider than the viewport',
              status: 'failed',
              evidence: rsAlsoText(pe, w, true) + tailFor(),
              loads: loads,
              tile: tile ? tile.id : null,
              extra: { width: w, variant: t.label, gapPx: -overflow, alsoOnProd: pe, severity: qkSeverity(w) },
            })));
          }
          if (!offs.length && !total && !overflow) {
            rows.push(qkRow(Object.assign({}, base, {
              id: 'rs.' + t.label + '.' + w,
              check: 'Nothing clipped at ' + w + ' px',
              expected: 'no text outside the viewport or its container, page not wider than the viewport',
              observed: 'nothing clipped, page fits the viewport',
              status: 'passed',
              evidence: 'scanned a ' + sc.vw + ' px viewport, ' + (sc.nodes != null ? sc.nodes + ' nodes' : 'nodes not counted'),
              loads: loads,
            })));
          }
          return;
        }
        // not measured
        let r;
        if (e && e.skipped && !rec.halted) {
          if (e.skipped === 'conv-forced') r = { status: 'blocked', evidence: 'Blocked: ' + t.label + ' forces with _conv_eforce, which this mode never loads' };
          else if (e.skipped === 'not-served') r = { status: 'blocked', evidence: 'Blocked: ' + t.label + ' did not serve the forced variation ' + ((t.forcedIds || []).join(', ') || '(unknown)') + ' (this mode never adds optimizely_force_tracking)' };
          else r = { status: 'not-tested', evidence: 'Not run: the link is not a web address' };
        } else if (e && e.loadError && !e.skipped) {
          r = { status: 'not-tested', evidence: 'Not run: the page did not load (' + qkMaskOutput(e.loadError) + ')' };
        } else if (e && e.scan && e.scan.error && !e.skipped) {
          r = { status: 'not-tested', evidence: 'Not run: the clipping scan failed (' + qkMaskOutput(e.scan.error) + ')' };
        } else r = rsNoObservation(rec, 'not measured');
        rows.push(qkRow(Object.assign({}, base, {
          id: 'rs.' + t.label + '.' + w,
          check: 'Nothing clipped at ' + w + ' px',
          expected: 'no text outside the viewport or its container, page not wider than the viewport',
          observed: 'not measured',
          status: r.status,
          evidence: r.evidence,
          loads: loads,
        })));
      });
    });
    // rs.prod
    const prodBase = {
      id: 'rs.prod', step: 'prod', check: 'PROD measured at every width', emulated: false,
      expected: 'PROD loads and scans at each width, to tell a regression from a live issue', extra: {},
    };
    if (!input.prodUrl) {
      rows.push(qkRow(Object.assign({}, prodBase, { observed: 'no PROD URL', status: 'not-tested', evidence: 'Missing input: PROD URL (Initialize, or the PROD URL field above)' })));
    } else {
      const prodEntries = sweep.filter(function (e) { return e && e.role === 'prod'; });
      const missing = widthsAsc.filter(function (w) {
        return !prodEntries.some(function (e) { return e.width === w && rsScanOk(e.scan) && !e.skipped; });
      });
      const ids = [];
      prodEntries.forEach(function (e) { if (e.loadId && ids.indexOf(e.loadId) < 0) ids.push(e.loadId); });
      if (!missing.length && widthsAsc.length) {
        rows.push(qkRow(Object.assign({}, prodBase, { observed: rsProdModeText(plan), status: 'passed', evidence: 'loads ' + ids.join(', ') })));
      } else {
        const failed = prodEntries.filter(function (e) { return e.loadError; })[0];
        const r = rsNoObservation(rec, 'PROD was not measured at ' + missing.join(', ') + ' px' + (failed ? ' (' + qkMaskOutput(failed.loadError) + ')' : ''));
        rows.push(qkRow(Object.assign({}, prodBase, {
          observed: 'measured at ' + (widthsAsc.length - missing.length) + ' of ' + widthsAsc.length + ' widths', status: r.status, evidence: r.evidence, loads: ids,
        })));
      }
    }
    return rows;
  }

  function rsSummaryProjection(rec) {
    rec = rec || {};
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    return {
      stopped: !!rec.stopped,
      halted: rec.halted ? qkMaskDeep(rec.halted) : null,
      error: rec.error ? qkMaskOutput(rec.error) : null,
      counts: qkCounts(rows),
      rows: qkSortRows(rows).slice(0, 40).map(function (r) {
        return { id: r.id, verdict: qkVerdictText(r), check: qkMaskOutput(r.check), observed: qkMaskOutput(r.observed).slice(0, 160) };
      }),
    };
  }
  function rsDebugProjection(rec) {
    const c = Object.assign({}, rec || {});
    c.tiles = (Array.isArray(c.tiles) ? c.tiles : []).map(function (t) {
      return { id: t.id, target: t.target, width: t.width, gapPx: t.gapPx, hasImage: typeof t.img === 'string' && t.img.length > 0 };
    });
    return qkMaskDeep(c);
  }
  function rsReportFootHtml(rec) {
    rec = rec || {};
    const counts = {};
    const order = [];
    (rec.loads || []).forEach(function (L) {
      if (!L) return;
      const p = qkMaskOutput(L.path || '(no address)');
      if (!counts[p]) { counts[p] = 0; order.push(p); }
      counts[p]++;
    });
    const widths = ((rec.plan && rec.plan.widths) || []).slice().sort(function (a, b) { return a - b; });
    const d = function (s) { return '<div>' + qkEsc(qkMaskOutput(s)) + '</div>'; };
    return d('Pages loaded: ' + (order.map(function (p) { return p + ' (×' + counts[p] + ')'; }).join(', ') || 'none'))
      + d(qkFreshText(qkFreshCount(rec.loads)))
      + d('Desktop Chrome with emulated viewport widths ' + widths.join(', ') + '; no phone user agent or touch.');
  }

  const RS_ENGINE = {
    mode: RS_MODE, label: RS_LABEL, version: RS_RECORD_VERSION,
    sanitize: rsSanitizeInput, newRecord: rsNewRecord, run: rsRun, derive: rsDeriveRows,
  };

  Object.assign(EXPORTS, { rsRun, rsDeriveRows, rsSummaryProjection, rsDebugProjection, rsReportFootHtml, RS_ENGINE });

  Object.keys(EXPORTS).forEach(function (k) { g[k] = EXPORTS[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : this);
