// itw-activation.js — Test Agent mode 1, ITW Activation: does the experiment activate for exactly the right visitors on
// the real ITW link, and is Control genuinely PROD? Shared by background.js (importScripts) and both panels (<script src>
// before popup.js). Classic script, no module syntax.
//
// Naming: ia* / IA_* are defined only here. This file calls the shared kit (qa-kit.js: qk* / QK_*) but never at load
// time: every use of a kit name is inside a function, so the load order of the two files does not matter.
//
// The engine (IA_ENGINE) never touches the browser. The worker hands iaRun an `io` object (now, checkStop, sleep, debug,
// progress, load, state, facts, catalog, click, storageNames, viewport, scan, shot, compose: plan section 3.1) and iaRun
// only orchestrates and records what it saw in `rec`; iaDeriveRows later turns the record into one row per assertion,
// with no further browser access.
//
// Never optimizely_force_tracking and never _conv_eforce: every URL iaRun loads is built by qkBuildUrl (which strips
// both). Desktop Chrome only: nothing here asks for a phone user agent or touch.
(function (g) {
  'use strict';

  const EXPORTS = {};

  // ── Constants ────────────────────────────────────────────────────────────
  const IA_RECORD_VERSION = 1;
  const IA_MODE = 'itwactivation';
  const IA_LABEL = 'ITW Activation';
  const IA_MAX_SUBPAGES = 6;
  const IA_MAX_STAY = 4;
  const IA_MAX_AUDIENCE_LOADS = 12;
  const IA_MAX_AUDIENCES = 20;
  const IA_COLUMNS = [
    { key: 'check', label: 'Check' },
    { key: 'expected', label: 'Expected' },
    { key: 'observed', label: 'Observed' },
    { key: 'verdict', label: 'Verdict' },
    { key: 'evidence', label: 'Evidence' },
  ];
  // D18: the only remediation text for a Control that differs from PROD. No row text is built by a model.
  const IA_CONTROL_REMEDY = 'Remedy: Control has to be the page PROD visitors get. Find what alters it for this visitor (code in the Control variation, shared project JavaScript, or another experiment that runs with cro_mode=qa) and fix that targeting or setup.';
  const IA_REDIRECT_REMEDY = 'Remedy: a targeting bug. Add an exclusion audience (or narrow the page targeting) so a visitor who lands on the destination directly is not bucketed into this experiment.';
  // Where each of the inputs came from (typed / ticket / derived / none), in this order.
  const IA_SOURCE_KEYS = ['experimentId', 'itwUrl', 'controlUrl', 'activation', 'triggerSelector', 'triggerDescription', 'subPages', 'stayActive', 'audiences', 'storedKeys', 'returning', 'redirectDest'];
  const IA_SOURCE_VALUES = ['typed', 'ticket', 'derived', 'none'];

  Object.assign(EXPORTS, {
    IA_RECORD_VERSION, IA_MODE, IA_LABEL, IA_MAX_SUBPAGES, IA_MAX_STAY, IA_MAX_AUDIENCE_LOADS, IA_MAX_AUDIENCES, IA_COLUMNS,
    IA_CONTROL_REMEDY, IA_REDIRECT_REMEDY,
  });

  // ── Small helpers ────────────────────────────────────────────────────────
  // A trimmed string of at most n characters, or null when empty.
  function iaStr(v, n) {
    const s = String(v == null ? '' : v).trim();
    return s ? s.slice(0, n) : null;
  }
  // Trimmed, non-empty strings, each at most n characters, at most max of them.
  function iaList(v, n, max) {
    const out = [];
    (Array.isArray(v) ? v : []).forEach(function (x) {
      const s = String(x == null ? '' : x).trim();
      if (s && out.length < max) out.push(s.slice(0, n));
    });
    return out;
  }
  // One audience as the context and the input carry it; null when it has no name, no parameter and no value.
  function iaCleanAudience(a) {
    a = a && typeof a === 'object' ? a : {};
    const name = String(a.name == null ? '' : a.name).trim().slice(0, 300);
    const param = iaStr(a.param, 300);
    let value = iaStr(a.value, 300);
    if (!name && !param && !value) return null;
    const type = ['query', 'cookie', 'device', 'other'].indexOf(a.type) >= 0 ? a.type : 'other';
    if (type === 'device') {
      const dv = String(value == null ? '' : value).toLowerCase();
      value = dv === 'desktop' || dv === 'mobile' ? dv : null;
    }
    return {
      name: name,
      role: a.role === 'inclusion' ? 'inclusion' : 'exclusion',
      type: type,
      param: param,
      value: value,
      description: String(a.description == null ? '' : a.description).trim().slice(0, 300),
    };
  }
  function iaCleanAudiences(list, max) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (a) {
      const c = iaCleanAudience(a);
      if (c && out.length < max) out.push(c);
    });
    return out;
  }
  function iaEnum(v, list) { return list.indexOf(v) >= 0 ? v : null; }
  // The host of an http(s) address, or null.
  function iaHost(u) {
    const m = /^https?:\/\/([^\/?#:]+)/i.exec(String(u == null ? '' : u).trim());
    return m ? m[1].toLowerCase() : null;
  }

  // ── Context: the Initialize fields (D15) ─────────────────────────────────
  // The nine fields of an Initialize context that Mode 1 reads; a context saved before they existed lacks them.
  function iaDefaultCtxFields() {
    return {
      activationType: null, triggerDescription: null, triggerSelector: null, subPages: [], stayActivePages: [],
      specAudiences: [], storedStateKeys: [], returningVisitor: null, redirectDestination: null,
    };
  }
  // The AI extraction's `itw` object (Appendix C) mapped onto the nine context fields; anything else gives the defaults.
  function iaCtxFieldsFromAi(itw) {
    const d = iaDefaultCtxFields();
    if (!itw || typeof itw !== 'object' || Array.isArray(itw)) return d;
    const strs = function (x) { return Array.isArray(x) ? x.filter(function (s) { return typeof s === 'string'; }) : []; };
    d.activationType = iaEnum(itw.activationType, ['immediate', 'trigger']);
    d.triggerDescription = typeof itw.triggerDescription === 'string' ? itw.triggerDescription : null;
    d.triggerSelector = typeof itw.triggerSelector === 'string' ? itw.triggerSelector : null;
    d.subPages = strs(itw.subPages);
    d.stayActivePages = strs(itw.stayActivePages);
    d.specAudiences = (Array.isArray(itw.audiences) ? itw.audiences : []).filter(function (a) { return a && typeof a === 'object'; }).map(function (a) {
      return {
        name: String(a.name == null ? '' : a.name),
        role: a.role === 'inclusion' ? 'inclusion' : 'exclusion',
        type: ['query', 'cookie', 'device', 'other'].indexOf(a.type) >= 0 ? a.type : 'other',
        param: typeof a.param === 'string' ? a.param : null,
        value: typeof a.value === 'string' ? a.value : null,
        description: String(a.description == null ? '' : a.description),
      };
    });
    d.storedStateKeys = strs(itw.storedStateKeys);
    d.returningVisitor = iaEnum(itw.returningVisitor, ['active', 'inactive']);
    d.redirectDestination = typeof itw.redirectDestination === 'string' ? itw.redirectDestination : null;
    return d;
  }
  // Exactly the nine keys, validated, trimmed and capped. A stored-key pattern that is too broad (a lone *, a prefix under
  // three characters) is dropped: the run tab is the tester's own profile.
  function iaNormalizeCtxFields(d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      activationType: iaEnum(d.activationType, ['immediate', 'trigger']),
      triggerDescription: iaStr(d.triggerDescription, 300),
      triggerSelector: iaStr(d.triggerSelector, 300),
      subPages: iaList(d.subPages, 500, 50),
      stayActivePages: iaList(d.stayActivePages, 500, 50),
      specAudiences: iaCleanAudiences(d.specAudiences, IA_MAX_AUDIENCES),
      storedStateKeys: qkCleanPatterns(d.storedStateKeys),
      returningVisitor: iaEnum(d.returningVisitor, ['active', 'inactive']),
      redirectDestination: iaStr(d.redirectDestination, 500),
    };
  }
  // The review card block of Appendix B.3. Every value goes through qkEsc; the current option carries `selected`.
  function iaInitFieldsHtml(d) {
    d = d && typeof d === 'object' ? d : {};
    const q = function (s) { return qkEsc(s == null ? '' : s); };
    const none = '<div style="font-size:11px;color:var(--fg3)">None found in ticket.</div>';
    const select = function (path, current, options) {
      return '<select data-init="' + path + '">' + options.map(function (o) {
        return '<option value="' + o[0] + '"' + ((current || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>';
    };
    const rm = function (list, i) { return '<button class="btn-icon" data-init-rm="' + list + '.' + i + '" title="Remove" style="color:var(--err)">✕</button>'; };
    const plainList = function (key, items, placeholder) {
      if (!items.length) return none;
      return '<div style="display:flex;flex-direction:column;gap:4px">' + items.map(function (v, i) {
        return '<div class="ab-sel-row"><input type="text" data-init="' + key + '.' + i + '" value="' + q(v) + '" placeholder="' + q(placeholder) + '">' + rm(key, i) + '</div>';
      }).join('') + '</div>';
    };
    const subPages = Array.isArray(d.subPages) ? d.subPages : [];
    const stay = Array.isArray(d.stayActivePages) ? d.stayActivePages : [];
    const auds = Array.isArray(d.specAudiences) ? d.specAudiences : [];
    const keys = Array.isArray(d.storedStateKeys) ? d.storedStateKeys : [];
    const audRows = auds.map(function (a, i) {
      a = a && typeof a === 'object' ? a : {};
      const p = 'specAudiences.' + i;
      return '<div class="ab-sel-row" style="flex-wrap:wrap">'
        + '<input type="text" data-init="' + p + '.name" value="' + q(a.name) + '" placeholder="Name" style="flex:1 1 90px">'
        + select(p + '.role', a.role === 'inclusion' ? 'inclusion' : 'exclusion', [['exclusion', 'exclude'], ['inclusion', 'include']])
        + select(p + '.type', ['query', 'cookie', 'device', 'other'].indexOf(a.type) >= 0 ? a.type : 'other', [['query', 'query'], ['cookie', 'cookie'], ['device', 'device'], ['other', 'other']])
        + '<input type="text" data-init="' + p + '.param" value="' + q(a.param) + '" placeholder="Parameter" style="max-width:90px;flex:0 1 auto">'
        + '<input type="text" data-init="' + p + '.value" value="' + q(a.value) + '" placeholder="Value" style="max-width:90px;flex:0 1 auto">'
        + rm('specAudiences', i) + '</div>';
    }).join('');
    const audList = auds.length ? '<div style="display:flex;flex-direction:column;gap:4px">' + audRows + '</div>' : none;
    const add = function (list, label) { return '<button class="btn sm" data-init-add="' + list + '" style="margin:5px 0 10px">' + label + '</button>'; };
    return '<label class="cap">ITW Activation — activation and targeting from the spec (AI-extracted; check before saving)</label>'
      + '<div class="arg-row" style="margin-bottom:5px"><span class="arg-lbl">Activation</span>'
      + select('activationType', d.activationType, [['', '— not stated —'], ['immediate', 'On page load'], ['trigger', 'On a trigger']]) + '</div>'
      + '<div class="arg-row" style="margin-bottom:5px"><span class="arg-lbl">Trigger</span>'
      + '<input type="text" data-init="triggerDescription" value="' + q(d.triggerDescription) + '" placeholder="The spec\'s words for the trigger"></div>'
      + '<div class="arg-row" style="margin-bottom:5px"><span class="arg-lbl">Trigger selector</span>'
      + '<input type="text" data-init="triggerSelector" value="' + q(d.triggerSelector) + '" placeholder="CSS selector, only when the spec gives one"></div>'
      + '<label class="cap">Sub-pages where it must NOT activate on load</label>' + plainList('subPages', subPages, '/path or URL') + add('subPages', '+ Add Sub-page')
      + '<label class="cap">Pages where it must STAY active after the trigger</label>' + plainList('stayActivePages', stay, '/path or URL') + add('stayActivePages', '+ Add Page')
      + '<label class="cap">Spec audiences</label>' + audList + add('specAudiences', '+ Add Audience')
      + '<label class="cap">Stored-state keys (saved answers, quiz progress; a trailing * matches a prefix)</label>' + plainList('storedStateKeys', keys, 'Key name') + add('storedStateKeys', '+ Add Key')
      + '<div class="arg-row" style="margin-bottom:5px"><span class="arg-lbl">Returning visitor</span>'
      + select('returningVisitor', d.returningVisitor, [['', '— not stated —'], ['active', 'Stays active'], ['inactive', 'Not active']]) + '</div>'
      + '<div class="arg-row" style="margin-bottom:10px"><span class="arg-lbl">Redirect destination</span>'
      + '<input type="text" data-init="redirectDestination" value="' + q(d.redirectDestination) + '" placeholder="Only for a redirect test"></div>';
  }
  // One audience line of the panel's textarea. 'device desktop' | 'device mobile'; '(exclude|include) cookie <name>[=<v>]';
  // '(exclude|include) <param>[=<value>]'; anything else is an audience of type 'other' that cannot be set from the URL.
  function iaParseAudienceLine(line) {
    const t = String(line == null ? '' : line).trim();
    let m = /^device\s+(desktop|mobile)$/i.exec(t);
    if (m) return { name: t, role: 'inclusion', type: 'device', param: null, value: m[1].toLowerCase(), description: '' };
    m = /^(exclude|include)\s+cookie\s+([^\s=]+)(?:\s*=\s*(.*))?$/i.exec(t);
    if (m) return { name: t, role: m[1].toLowerCase() === 'include' ? 'inclusion' : 'exclusion', type: 'cookie', param: m[2], value: m[3] ? m[3].trim() : null, description: '' };
    m = /^(exclude|include)\s+([^\s=]+)(?:\s*=\s*(.*))?$/i.exec(t);
    if (m) return { name: t, role: m[1].toLowerCase() === 'include' ? 'inclusion' : 'exclusion', type: 'query', param: m[2], value: m[3] ? m[3].trim() : null, description: '' };
    return { name: t, role: 'exclusion', type: 'other', param: null, value: null, description: t };
  }
  // The inverse of iaParseAudienceLine, one line per audience (a placeholder shows these).
  function iaAudiencesToLines(list) {
    return (Array.isArray(list) ? list : []).map(function (a) {
      a = a && typeof a === 'object' ? a : {};
      const verb = a.role === 'inclusion' ? 'include' : 'exclude';
      const tail = a.value ? '=' + a.value : '';
      if (a.type === 'device') return 'device ' + (a.value || '');
      if (a.type === 'cookie') return verb + ' cookie ' + (a.param || '') + tail;
      if (a.type === 'query') return verb + ' ' + (a.param || '') + tail;
      return String(a.description || a.name || '');
    }).filter(Boolean);
  }

  // ── Panel: building the input (D14) ──────────────────────────────────────
  // A typed address: http(s), or a bare host with a dot (or localhost, or a host with a port). A path is allowed only
  // where the caller says so. Anything else (another scheme, spaces, a sentence) is not an address.
  function iaTypedUrl(raw, allowPath) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return null;
    if (allowPath && t.charAt(0) === '/') return t.slice(0, 500);
    if (/\s/.test(t)) return null;
    const m = /^(https?:\/\/)?([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|localhost|\[[0-9a-fA-F:]+\])(:\d+)?([\/?#]\S*)?$/.exec(t);
    if (!m) return null;
    return qkAbsUrl(t).slice(0, 500);
  }
  // `values` = {<field key>: <the element's raw string>}; ctx = the reviewed ticket context or null. A field left empty
  // takes the ticket's value; a typed value wins. Returns {ok:true, input} (the 14 keys) or {ok:false, error}.
  function iaBuildInput(ctx, values) {
    const v = values && typeof values === 'object' ? values : {};
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const typed = function (k) { return String(v[k] == null ? '' : v[k]).trim(); };
    const src = {};
    const addr = function (srcKey, field, key, ticketVal, allowPath) {
      const t = typed(key);
      if (t) {
        const u = iaTypedUrl(t, allowPath);
        if (!u) return { error: field + ': not a web address' };
        src[srcKey] = 'typed';
        return { value: u };
      }
      const tk = String(ticketVal == null ? '' : ticketVal).trim();
      if (tk) {
        src[srcKey] = 'ticket';
        return { value: (allowPath && tk.charAt(0) === '/' ? tk : qkAbsUrl(tk)).slice(0, 500) };
      }
      src[srcKey] = 'none';
      return { value: null };
    };
    const itw = addr('itwUrl', 'ITW link', 'itw', c.itwLink, false);
    if (itw.error) return { ok: false, error: itw.error };
    const ctl = qkControlLink(c);
    const control = addr('controlUrl', 'Control link', 'control', ctl && ctl.url, false);
    if (control.error) return { ok: false, error: control.error };
    const redirect = addr('redirectDest', 'Redirect destination', 'redirect', c.redirectDestination, true);
    if (redirect.error) return { ok: false, error: redirect.error };
    if (!itw.value && !control.value && !redirect.value) {
      return { ok: false, error: 'ITW Activation needs an ITW link, a Control link or a redirect destination: set them in the Initialize tab or type them above.' };
    }
    const text = function (srcKey, key, ticketVal, n) {
      const t = typed(key);
      if (t) { src[srcKey] = 'typed'; return t.slice(0, n); }
      const tk = iaStr(ticketVal, n);
      src[srcKey] = tk ? 'ticket' : 'none';
      return tk;
    };
    const choice = function (srcKey, key, ticketVal, list) {
      const t = typed(key);
      if (list.indexOf(t) >= 0) { src[srcKey] = 'typed'; return t; }
      const tk = iaEnum(ticketVal, list);
      src[srcKey] = tk ? 'ticket' : 'none';
      return tk;
    };
    const lines = function (srcKey, key, ticketList) {
      const t = qkLines(typed(key));
      if (t.length) { src[srcKey] = 'typed'; return t.map(function (s) { return s.slice(0, 500); }).slice(0, 50); }
      const tk = iaList(ticketList, 500, 50);
      src[srcKey] = tk.length ? 'ticket' : 'none';
      return tk;
    };
    const experimentId = text('experimentId', 'exp', c.experimentId, 60);
    const activation = choice('activation', 'activation', c.activationType, ['immediate', 'trigger']);
    const triggerSelector = text('triggerSelector', 'trigger', c.triggerSelector, 300);
    const triggerDescription = iaStr(c.triggerDescription, 300);
    src.triggerDescription = triggerDescription ? 'ticket' : 'none';
    const subPages = lines('subPages', 'subpages', c.subPages);
    const stayActive = lines('stayActive', 'stay', c.stayActivePages);
    let audiences;
    const audLines = qkLines(typed('audiences'));
    if (audLines.length) { src.audiences = 'typed'; audiences = audLines.map(iaParseAudienceLine).slice(0, IA_MAX_AUDIENCES); }
    else {
      audiences = iaCleanAudiences(c.specAudiences, IA_MAX_AUDIENCES);
      src.audiences = audiences.length ? 'ticket' : 'none';
    }
    let storedKeys;
    const keyLines = qkLines(typed('keys'));
    if (keyLines.length) {
      for (let i = 0; i < keyLines.length; i++) {
        if (!qkCleanPatterns([keyLines[i]]).length) {
          return { ok: false, error: 'Stored keys: "' + keyLines[i] + '" is too broad: give exact names, or at least 3 characters before the *.' };
        }
      }
      src.storedKeys = 'typed';
      storedKeys = qkCleanPatterns(keyLines);
    } else {
      storedKeys = qkCleanPatterns(c.storedStateKeys);
      src.storedKeys = storedKeys.length ? 'ticket' : 'none';
    }
    const returning = choice('returning', 'returning', c.returningVisitor, ['active', 'inactive']);
    const sources = {};
    IA_SOURCE_KEYS.forEach(function (k) { sources[k] = src[k] || 'none'; });
    return {
      ok: true,
      input: {
        ticketKey: iaStr(c.ticketKey, 60),
        experimentId: experimentId,
        itwUrl: itw.value,
        controlUrl: control.value,
        activation: activation,
        triggerSelector: triggerSelector,
        triggerDescription: triggerDescription,
        subPages: subPages,
        stayActive: stayActive,
        audiences: audiences,
        storedKeys: storedKeys,
        returning: returning,
        redirectDest: redirect.value,
        sources: sources,
      },
    };
  }
  // The debug line naming the ticket the run read (never throws).
  function iaCtxLine(ctx) {
    try {
      if (!ctx || typeof ctx !== 'object') return 'No reviewed ticket context: every input comes from the fields above.';
      const yn = function (x) { return x ? 'yes' : 'no'; };
      const ctl = qkControlLink(ctx);
      return qkMaskOutput('Ticket context ' + (ctx.ticketKey || '(no key)') + ': ITW link ' + yn(ctx.itwLink) + ', Control link ' + yn(ctl && ctl.url)
        + ', experiment ID ' + yn(ctx.experimentId) + ', activation ' + (ctx.activationType || 'not stated') + ', '
        + (Array.isArray(ctx.subPages) ? ctx.subPages.length : 0) + ' sub-page(s), ' + (Array.isArray(ctx.stayActivePages) ? ctx.stayActivePages.length : 0)
        + ' stay page(s), ' + (Array.isArray(ctx.specAudiences) ? ctx.specAudiences.length : 0) + ' spec audience(s)');
    } catch (e) { return 'The ticket context could not be summarised.'; }
  }
  // The debug line saying where each input came from (never throws).
  function iaInputLine(input) {
    try {
      if (!input || typeof input !== 'object') return 'No input was built.';
      const s = input.sources || {};
      return 'Inputs: ' + IA_SOURCE_KEYS.map(function (k) { return k + ' ' + (IA_SOURCE_VALUES.indexOf(s[k]) >= 0 ? s[k] : 'none'); }).join(', ');
    } catch (e) { return 'The inputs could not be summarised.'; }
  }

  // The panel engine (popup.js, qkUi*) reads this. Field ids are the whole markup ids of Appendix B.1; a field's key is
  // its id without 'ia-'; ph(ctx) returns the ticket's value as plain display text, or '' when the ticket has none.
  const IA_PANEL = {
    mode: IA_MODE,
    label: IA_LABEL,
    prefix: 'ia',
    action: 'runItwActivation',
    version: IA_RECORD_VERSION,
    columns: IA_COLUMNS,
    overridesKey: 'iaOverrides',
    settingsKey: null,
    lastRunKey: 'iaLastRun',
    debugLastKey: 'iaDebugLast',
    csvBase: 'itw-activation',
    fields: [
      { key: 'itw', id: 'ia-itw', kind: 'text', scope: 'ticket', ph: function (ctx) { return (ctx && ctx.itwLink) || ''; } },
      { key: 'control', id: 'ia-control', kind: 'text', scope: 'ticket', ph: function (ctx) { const l = qkControlLink(ctx); return (l && l.url) || ''; } },
      { key: 'exp', id: 'ia-exp', kind: 'text', scope: 'ticket', ph: function (ctx) { return (ctx && ctx.experimentId) || ''; } },
      { key: 'activation', id: 'ia-activation', kind: 'select', scope: 'ticket', ph: function (ctx) { return ({ immediate: 'On page load', trigger: 'On a trigger' })[ctx && ctx.activationType] || ''; } },
      { key: 'trigger', id: 'ia-trigger', kind: 'text', scope: 'ticket', ph: function (ctx) { return (ctx && ctx.triggerSelector) || ''; } },
      { key: 'subpages', id: 'ia-subpages', kind: 'lines', scope: 'ticket', ph: function (ctx) { return iaList(ctx && ctx.subPages, 500, 50).join('\n'); } },
      { key: 'stay', id: 'ia-stay', kind: 'lines', scope: 'ticket', ph: function (ctx) { return iaList(ctx && ctx.stayActivePages, 500, 50).join('\n'); } },
      { key: 'audiences', id: 'ia-audiences', kind: 'lines', scope: 'ticket', ph: function (ctx) { return iaAudiencesToLines(ctx && ctx.specAudiences).join('\n'); } },
      { key: 'keys', id: 'ia-keys', kind: 'lines', scope: 'ticket', ph: function (ctx) { return iaList(ctx && ctx.storedStateKeys, 100, 50).join('\n'); } },
      { key: 'returning', id: 'ia-returning', kind: 'select', scope: 'ticket', ph: function (ctx) { return ({ active: 'Stays active', inactive: 'Not active' })[ctx && ctx.returningVisitor] || ''; } },
      { key: 'redirect', id: 'ia-redirect', kind: 'text', scope: 'ticket', ph: function (ctx) { return (ctx && ctx.redirectDestination) || ''; } },
    ],
    buildInput: iaBuildInput,
    ctxLine: iaCtxLine,
    inputLine: iaInputLine,
  };

  Object.assign(EXPORTS, {
    iaCtxFieldsFromAi, iaNormalizeCtxFields, iaInitFieldsHtml, iaParseAudienceLine, iaAudiencesToLines, iaBuildInput,
    iaCtxLine, iaInputLine, IA_PANEL,
  });

  // ── Engine: the input, the record, the plan ──────────────────────────────
  // The 14 keys, types and caps re-applied (the worker never trusts a message).
  function iaSanitizeInput(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const addr = function (v) { const t = iaStr(v, 500); return t ? qkAbsUrl(t) : null; };
    const src = r.sources && typeof r.sources === 'object' ? r.sources : {};
    const sources = {};
    IA_SOURCE_KEYS.forEach(function (k) { sources[k] = IA_SOURCE_VALUES.indexOf(src[k]) >= 0 ? src[k] : 'none'; });
    const dest = iaStr(r.redirectDest, 500);
    return {
      ticketKey: iaStr(r.ticketKey, 60),
      experimentId: iaStr(r.experimentId, 60),
      itwUrl: addr(r.itwUrl),
      controlUrl: addr(r.controlUrl),
      activation: iaEnum(r.activation, ['immediate', 'trigger']),
      triggerSelector: iaStr(r.triggerSelector, 300),
      triggerDescription: iaStr(r.triggerDescription, 300),
      subPages: iaList(r.subPages, 500, 50),
      stayActive: iaList(r.stayActive, 500, 50),
      audiences: iaCleanAudiences(r.audiences, IA_MAX_AUDIENCES),
      storedKeys: qkCleanPatterns(r.storedKeys),
      returning: iaEnum(r.returning, ['active', 'inactive']),
      redirectDest: dest && dest.charAt(0) === '/' ? dest : (dest ? qkAbsUrl(dest) : null),
      sources: sources,
    };
  }
  function iaMaskInput(input) {
    return qkMaskDeep(input);
  }
  // The activation type a run uses (D28): the input, else the snippet's (a conditional page means a trigger).
  function iaActivationUsed(input, baselineState) {
    const st = baselineState && baselineState.readable !== false && baselineState.platform ? baselineState : null;
    const snippetType = st ? (st.activationType || null) : null;
    const t = input && input.activation;
    if (t === 'immediate' || t === 'trigger') {
      const s = input.sources && input.sources.activation;
      return { type: t, source: s === 'typed' || s === 'ticket' ? s : 'input', snippetType: snippetType };
    }
    if (st && st.conditional === true) return { type: 'trigger', source: 'snippet', snippetType: snippetType };
    if (st && st.conditional === false) return { type: 'immediate', source: 'snippet', snippetType: snippetType };
    return { type: null, source: null, snippetType: snippetType };
  }
  // The 18-key record (plan 3.3). The worker fills finishedAt, stopped, halted, error and rows; iaRun fills the rest.
  function iaNewRecord(input, now) {
    input = input && typeof input === 'object' ? input : iaSanitizeInput(null);
    const s = input.sources || {};
    return {
      version: IA_RECORD_VERSION,
      mode: IA_MODE,
      ts: now,
      startedAt: now,
      finishedAt: null,
      stopped: false,
      halted: null,
      error: null,
      ticketKey: input.ticketKey || null,
      input: iaMaskInput(input),
      experimentId: input.experimentId || null,
      experimentIdSource: input.experimentId ? (s.experimentId === 'typed' || s.experimentId === 'ticket' ? s.experimentId : 'ticket') : null,
      refusedItw: false,
      activation: iaActivationUsed(input, null),
      catalog: null,
      loads: [],
      obs: {
        baseline: null, trigger: null, stay: [], returning: null, subPages: [],
        audiences: { source: 'none', items: [], capped: [], notExercised: [] },
        control: null, prod: null, redirect: null,
      },
      rows: [],
    };
  }
  // The part of the snippet this mode reads, for one experiment (masked).
  function iaCatalogSlice(cat, expId) {
    if (!cat || cat.error || cat.platform !== 'optimizely') return null;
    const exp = qkExperimentById(cat, expId);
    return qkMaskDeep({
      experimentId: expId == null ? null : String(expId),
      found: !!exp,
      name: exp ? qkNul(exp.name) : null,
      variations: exp && Array.isArray(exp.variations) ? exp.variations.slice(0, 20).map(function (v) { return { id: String(v && v.id), name: v && v.name != null ? String(v.name) : null }; }) : [],
      activation: exp ? qkExperimentActivation(cat, exp) : { pages: [], conditional: null },
      allocation: exp ? qkAllocation(cat, exp) : { partial: false, holdback: null, weightsEnd: null, text: null },
      audienceTests: exp ? qkAudienceTests(exp, cat.audiences) : { tests: [], notExercised: [] },
    });
  }
  // Does the link already carry <param>=<value>?
  function iaCarries(url, param, value) {
    const p = qkSplitUrl(url);
    if (!p) return false;
    return p.params.some(function (q) {
      return qkKeyOf(q[0]) === String(param).toLowerCase() && qkDecode(q[1] == null ? '' : q[1]) === String(value);
    });
  }
  // The audience checks, from the spec (or, when it lists none, the snippet): items = the loads to make plus the device
  // items; capped = whole groups of loads over the cap. Items carry the raw URL to load (the worker's record keeps a
  // masked copy).
  function iaAudiencePlan(input, catalogSlice, itwUrl, activation) {
    input = input && typeof input === 'object' ? input : {};
    const needsClick = !!(activation && activation.type === 'trigger');
    const spec = Array.isArray(input.audiences) ? input.audiences : [];
    let source = 'none';
    let notExercised = [];
    const entries = [];
    if (spec.length) {
      source = 'spec';
      spec.slice(0, IA_MAX_AUDIENCES).forEach(function (a) {
        entries.push({ name: a.name || a.param || a.value || '', role: a.role === 'inclusion' ? 'inclusion' : 'exclusion', type: a.type || 'other', param: a.param || null, value: a.value || null });
      });
    } else if (catalogSlice && catalogSlice.found && catalogSlice.audienceTests) {
      const t = catalogSlice.audienceTests;
      notExercised = Array.isArray(t.notExercised) ? t.notExercised.slice() : [];
      const compSeen = {};
      (t.tests || []).forEach(function (x) {
        if (x.kind === 'device') {
          if (x.profile === 'desktop') entries.push({ name: x.audienceName || '', role: 'inclusion', type: 'device', param: null, value: x.expect === 'active' ? 'desktop' : 'mobile' });
          return;
        }
        if (x.kind !== 'query' || x.role === 'companion') return;
        const comp = !(x.role === 'exclusion' && compSeen[String(x.param).toLowerCase()]);
        if (x.role === 'exclusion') compSeen[String(x.param).toLowerCase()] = true;
        entries.push({ name: x.audienceName || x.param || '', role: x.role === 'inclusion' ? 'inclusion' : 'exclusion', type: 'query', param: x.param, value: x.value, noComp: !comp });
      });
      if (entries.length) source = 'snippet';
    }
    const mk = function (n, kind, e, extra) {
      return Object.assign({
        id: 'ia.5.' + n + '.' + kind, n: n, kind: kind, name: e.name || '', type: e.type, role: e.role, param: e.param || null, value: e.value || null,
        expect: null, url: '', skipLoad: false, missing: null, scope: null, needsClick: needsClick,
        loadId: null, ok: null, loadError: null, state: null, click: null,
      }, extra || {});
    };
    const groups = [];
    const devices = [];
    let n = 0;
    entries.forEach(function (e) {
      const label = e.name || e.param || 'unnamed';
      if (e.type === 'device') {
        const dv = e.value === 'desktop' || e.value === 'mobile' ? ((e.role === 'inclusion') === (e.value === 'desktop') ? 'desktop' : 'mobile') : null;
        if (dv) {
          if (!devices.some(function (d) { return d.value === dv; })) {
            devices.push({ id: 'ia.6.' + dv, n: null, kind: 'device', name: e.name || '', type: 'device', role: e.role, param: null, value: dv, expect: null, url: '', skipLoad: false, missing: null, scope: null, needsClick: false, loadId: null, ok: null, loadError: null, state: null, click: null });
          }
          return;
        }
        n++;
        groups.push({ label: label, items: [mk(n, 'other', e, { missing: 'the device (desktop or mobile) of audience ' + label })] });
        return;
      }
      n++;
      if (e.type === 'cookie' || e.type === 'other') {
        groups.push({ label: label, items: [mk(n, 'other', e, { scope: 'a ' + e.type + ' condition cannot be set from the URL in this version' })] });
        return;
      }
      if (e.type !== 'query' || !e.param) {
        groups.push({ label: label, items: [mk(n, 'other', e, { missing: 'the parameter name for audience ' + label })] });
        return;
      }
      if (e.role === 'exclusion') {
        if (!e.value) { groups.push({ label: label, items: [mk(n, 'excl', e, { missing: 'the excluding value for ' + e.param })] }); return; }
        const items = [mk(n, 'excl', e, { url: qkBuildUrl(itwUrl, [[e.param, e.value]]), expect: 'inactive' })];
        if (!e.noComp) items.push(mk(n, 'comp', e, { value: QK_COMPANION_VALUE, url: qkBuildUrl(itwUrl, [[e.param, QK_COMPANION_VALUE]]), expect: 'active' }));
        groups.push({ label: label, items: items });
        return;
      }
      const items = [mk(n, 'without', e, { url: qkBuildUrl(itwUrl, [], [e.param]), expect: 'inactive' })];
      if (!e.value) items.push(mk(n, 'with', e, { missing: 'the including value for ' + e.param }));
      else if (iaCarries(itwUrl, e.param, e.value)) items.push(mk(n, 'with', e, { skipLoad: true, expect: 'active' }));
      else items.push(mk(n, 'with', e, { url: qkBuildUrl(itwUrl, [[e.param, e.value]]), expect: 'active' }));
      groups.push({ label: label, items: items });
    });
    const items = [];
    const capped = [];
    let used = 0;
    let over = false;
    groups.forEach(function (gr) {
      const loads = gr.items.filter(function (it) { return it.url; }).length;
      if (over || used + loads > IA_MAX_AUDIENCE_LOADS) { over = true; if (loads) capped.push({ name: gr.label, loads: loads }); return; }
      used += loads;
      gr.items.forEach(function (it) { items.push(it); });
    });
    return { source: source, items: items.concat(devices), capped: capped, notExercised: notExercised };
  }
  // Reads the experiment state until it is active, at most QK_ACTIVATION_POLLS times, QK_ACTIVATION_POLL_MS apart.
  async function iaPollActive(io, args) {
    args = args || {};
    const max = args.maxPolls || QK_ACTIVATION_POLLS;
    const gap = args.pollMs || QK_ACTIVATION_POLL_MS;
    let s = null;
    let n = 0;
    for (;;) {
      io.checkStop();
      s = await io.state({ experimentId: args.experimentId == null ? null : args.experimentId, forcedIds: args.forcedIds || [] });
      n++;
      if ((s && s.activated) || n >= max) break;
      await io.sleep(gap);
    }
    return { state: s, polls: n };
  }

  // ── Engine: the run ──────────────────────────────────────────────────────
  // What a click result keeps in the record.
  function iaClickSlice(c) {
    if (!c || typeof c !== 'object') return { ok: false, reason: 'error', error: 'no result (the page script failed)', label: null, matches: null, coveredBy: null, why: null, navigated: false, final: null, blocked: null };
    return qkMaskDeep({
      ok: c.ok === true,
      reason: c.reason == null ? null : c.reason,
      label: c.label == null ? null : c.label,
      matches: c.matches == null ? null : c.matches,
      coveredBy: c.coveredBy == null ? null : c.coveredBy,
      why: c.why == null ? null : c.why,
      error: c.error == null ? null : c.error,
      navigated: !!c.navigated,
      final: c.final ? qkPathOnly(c.final) || null : null,
      blocked: c.blocked ? { reason: c.blocked.reason || 'bot-check', signal: c.blocked.signal || null } : null,
    });
  }
  // The page facts a comparison needs; the canonical address is reduced to its path (a canonical that echoes the page URL
  // would carry the forcing query of the link it was loaded from).
  function iaFactsSlice(f) {
    if (!f || typeof f !== 'object') return null;
    if (f.error) return { error: qkMaskOutput(f.error) };
    return {
      title: qkMaskOutput(f.title == null ? '' : f.title),
      canonical: f.canonical == null ? null : qkMaskOutput(qkStripQuery(f.canonical)),
      textLen: f.textLen || 0,
      textHash: f.textHash == null ? null : String(f.textHash),
      scrollHeight: f.scrollHeight || 0,
      widgets: { chat: (f.widgets && f.widgets.chat) || 0, banner: (f.widgets && f.widgets.banner) || 0, modal: (f.widgets && f.widgets.modal) || 0 },
    };
  }
  function iaLoadFail(L) { return (L && L.loadError) || (L && L.ok === false ? 'the page did not finish loading' : null); }
  // A page given as a path or an address, turned into the address to load: a path is resolved against the origin of
  // `base`, and a path or an address gets the link's other parameters (D27: a negative must not pass for the wrong reason). Never a tracking flag.
  function iaTarget(page, base, carryFrom) {
    const t = String(page == null ? '' : page).trim();
    let url = qkResolve(t, base);
    if (!url) return '';
    url = qkCarryParams(url, carryFrom || '');
    return qkBuildUrl(url);
  }

  // iaRun(io, rec, input): the order of plan section 5 S4: refusal check (no loads) -> baseline (clean) -> trigger click ->
  // stay pages (keepState) -> returning visitor -> sub-pages (clean) -> audience loads (clean) -> Control (clean) + facts
  // -> PROD (clean) + facts -> redirect destination (clean). Every load goes through qkLoadInto.
  async function iaRun(io, rec, input) {
    const obs = rec.obs;
    const keys = input.storedKeys || [];
    const itwRaw = input.itwUrl || '';
    const controlRaw = input.controlUrl || '';
    const refused = !!itwRaw && qkIsPreviewUrl(itwRaw);
    const itwUrl = itwRaw && !refused ? qkBuildUrl(itwRaw) : '';
    const convForced = !!controlRaw && qkTrackingFlags(controlRaw).indexOf('_conv_eforce') >= 0;
    const controlUrl = controlRaw && !convForced ? qkBuildUrl(controlRaw, [QK_QA_PARAM]) : '';
    const controlForced = controlRaw ? qkForcedIds(controlRaw) : [];
    const prodUrl = itwRaw || controlRaw ? qkBuildUrl(qkProdUrl(itwRaw || controlRaw)) : '';
    const pageBase = itwRaw || controlRaw;
    let expId = input.experimentId || null;

    const note = function (level, text) { io.debug(level, text); };
    const learn = function (s) {
      if (s && s.readable !== false && s.experimentId && !expId) {
        expId = String(s.experimentId);
        rec.experimentId = expId;
        rec.experimentIdSource = 'derived';
      }
    };
    const read = async function (label, forcedIds) {
      const s = await io.state({ experimentId: expId, forcedIds: forcedIds || [] });
      const d = qkDebugStateLine(label, s);
      note(d.level, d.text);
      learn(s);
      return s;
    };
    const doLoad = async function (role, label, url, keepState) {
      note('info', 'Loading ' + label + (keepState ? ' (keeps the visitor state)' : ' (a clean visitor)') + ': ' + (qkPathOnly(url) || '(no address)'));
      const L = await qkLoadInto(io, rec, { role: role, label: label, url: url, width: QK_PHASE_WIDTH, keepState: !!keepState, appKeys: keys });
      // No result line here: the worker's qkwLoad writes one per load in its finally, as for Mode 5 (A40).
      return L;
    };
    const step = async function (phase, label) {
      note('info', label);
      await io.progress({ phase: phase, label: label, width: QK_PHASE_WIDTH });
    };
    // A page of the sub-page / stay lists: load it and read the state once.
    const pageStep = async function (role, label, page, keepState) {
      const url = iaTarget(page, pageBase, pageBase);
      if (!url) {
        note('warn', label + ': "' + page + '" is not an address and no origin is known to resolve it against');
        return { page: qkMaskOutput(page), loadId: null, ok: false, loadError: null, unresolved: true, state: null };
      }
      const L = await doLoad(role, label, url, keepState);
      const e = { page: qkMaskOutput(page), loadId: L.id, ok: false, loadError: iaLoadFail(L), state: null };
      if (!e.loadError) { e.ok = true; e.state = await read(label, []); }
      return e;
    };

    note('info', 'ITW Activation run: ' + (itwRaw ? 'ITW link given' : 'no ITW link') + ', ' + (controlRaw ? 'Control link given' : 'no Control link') + ', activation ' + (input.activation || 'not stated'));
    if (refused) {
      rec.refusedItw = true;
      note('warn', 'The ITW link forces a variation (a preview link): audience and activation checks are not run on it');
    }

    let plan = null;
    if (itwUrl) {
      // 1. Baseline on the ITW link, a clean visitor.
      await step('baseline', 'Step 1: baseline on the ITW link');
      // The spec's audiences need no page: record the plan now, so a halt at the baseline still names every row.
      obs.audiences = qkMaskDeep(iaAudiencePlan(input, null, itwUrl, rec.activation));
      const L = await doLoad('itw', 'ITW baseline', itwUrl, false);
      const b = { loadId: L.id, ok: false, loadError: iaLoadFail(L), state: null, cleared: L.cleared ? L.cleared.slice(0, 60) : null };
      if (!b.loadError) {
        b.ok = true;
        b.state = await read('ITW baseline', controlForced);
        rec.catalog = iaCatalogSlice(await io.catalog(), expId);
      }
      rec.activation = iaActivationUsed(input, b.state);
      obs.baseline = b;
      plan = iaAudiencePlan(input, rec.catalog, itwUrl, rec.activation);
      obs.audiences = qkMaskDeep(plan);
      const base = iaBaseline(rec);

      if (base.kind === 'pass') {
        const act = rec.activation;
        // 2/3. The trigger: one trusted click on the same page, then the state is polled.
        if (act.type === 'trigger' && input.triggerSelector) {
          if (base.state.activated) {
            obs.trigger = { click: null, state: null, polls: 0, alreadyActive: true };
            note('info', 'Already active on page load: the trigger is not clicked');
          } else {
            await step('trigger', 'Step 3: click the trigger');
            const click = await io.click(input.triggerSelector);
            const t = { click: iaClickSlice(click), state: null, polls: 0, alreadyActive: false };
            if (click && click.blocked) { obs.trigger = t; qkHaltIfBlocked(click); }
            if (click && click.ok) {
              const p = await iaPollActive(io, { experimentId: expId, forcedIds: [] });
              t.state = p.state;
              t.polls = p.polls;
              const d = qkDebugStateLine('After the click', p.state);
              note(d.level, d.text + ' (' + p.polls + ' read(s))');
            } else {
              note('warn', 'The trigger was not clicked: ' + ((click && (click.reason || click.error)) || 'no result'));
            }
            obs.trigger = t;
          }
        }
        const positive = iaPositive(rec);
        // 3. Stay pages (the visitor keeps its state).
        if (positive && input.stayActive.length) {
          await step('stay', 'Step 3: pages where it must stay active');
          const pages = input.stayActive.slice(0, IA_MAX_STAY);
          for (let i = 0; i < pages.length; i++) obs.stay.push(await pageStep('stay', 'Stay page ' + (i + 1), pages[i], true));
        }
        // 4. The returning visitor: the stored names, then a reload of the ITW link keeping the state.
        if (positive && input.returning) {
          await step('returning', 'Step 4: returning visitor');
          const names = await io.storageNames(keys);
          const L2 = await doLoad('returning', 'Returning visitor', itwUrl, true);
          const e = {
            loadId: L2.id, ok: false, loadError: iaLoadFail(L2), state: null,
            storage: names && !names.error ? { local: names.local || [], session: names.session || [], cookies: names.cookies || [] } : { error: qkMaskOutput(names && names.error) || 'no result (the page script failed)' },
          };
          if (!e.loadError) { e.ok = true; e.state = await read('Returning visitor', []); }
          obs.returning = e;
        }
        // 2. Sub-pages (clean): the experiment must not activate on load.
        if (input.subPages.length) {
          await step('subpages', 'Step 2: sub-pages');
          const pages = input.subPages.slice(0, IA_MAX_SUBPAGES);
          for (let i = 0; i < pages.length; i++) obs.subPages.push(await pageStep('sub', 'Sub-page ' + (i + 1), pages[i], false));
        }
        // 5. Audiences (clean): one load each; in trigger mode the trigger is clicked first.
        const canRun = !(act.type === 'trigger' && !input.triggerSelector);
        const loadItems = plan.items.map(function (it, i) { return i; }).filter(function (i) { const it = plan.items[i]; return it.url && !it.skipLoad && !it.missing && !it.scope; });
        if (canRun && loadItems.length) {
          await step('audiences', 'Step 5: audience loads');
          for (let k = 0; k < loadItems.length; k++) {
            const raw = plan.items[loadItems[k]];
            const m = obs.audiences.items[loadItems[k]];
            const label = 'Audience ' + raw.id.replace(/^ia\./, '');
            const L3 = await doLoad('audience', label, raw.url, false);
            const err = iaLoadFail(L3);
            if (err) { m.loadId = L3.id; m.ok = false; m.loadError = err; continue; }
            if (act.type === 'trigger') {
              const click = await io.click(input.triggerSelector);
              const c = iaClickSlice(click);
              if (click && click.blocked) { m.loadId = L3.id; m.ok = true; m.click = c; qkHaltIfBlocked(click); }
              let st = null;
              if (click && click.ok) {
                const p = await iaPollActive(io, { experimentId: expId, forcedIds: [] });
                st = p.state;
                const d = qkDebugStateLine(label, st);
                note(d.level, d.text + ' (' + p.polls + ' read(s))');
              } else {
                note('warn', label + ': the trigger was not clicked (' + ((click && (click.reason || click.error)) || 'no result') + ')');
              }
              m.loadId = L3.id; m.ok = true; m.click = c; m.state = st;
            } else {
              const st = await read(label, []);
              m.loadId = L3.id; m.ok = true; m.state = st;
            }
          }
        }
      } else {
        note('warn', 'The baseline did not read, so steps 2 to 6 are not run');
      }
    }

    // 7. Control against PROD.
    if (controlRaw) {
      await step('control', 'Step 7: Control against PROD');
      if (convForced) {
        note('warn', 'The Control link forces with _conv_eforce, which this mode never loads');
        obs.control = { loadId: null, ok: false, loadError: null, state: null, facts: null, url: null, convForced: true, forcedIds: controlForced };
      } else {
        const L4 = await doLoad('control', 'Control (the Control link plus cro_mode=qa)', controlUrl, false);
        const c = { loadId: L4.id, ok: false, loadError: iaLoadFail(L4), state: null, facts: null, url: qkMaskOutput(controlUrl), forcedIds: controlForced };
        if (!c.loadError) {
          c.ok = true;
          c.state = await read('Control', controlForced);
          c.facts = iaFactsSlice(await io.facts());
        }
        obs.control = c;
        const L5 = await doLoad('prod', 'PROD (the plain page)', prodUrl, false);
        const p = {
          loadId: L5.id, ok: false, loadError: iaLoadFail(L5), state: null, facts: null, url: qkMaskOutput(prodUrl),
          requestedHost: iaHost(prodUrl), finalHost: iaHost(L5.final) || iaHost(prodUrl),
        };
        if (!p.loadError) {
          p.ok = true;
          p.state = await read('PROD', []);
          p.facts = iaFactsSlice(await io.facts());
        }
        obs.prod = p;
      }
    }

    // 8. A visitor who lands on the redirect destination directly.
    if (input.redirectDest) {
      await step('redirect', 'Step 8: the redirect destination');
      const url = iaTarget(input.redirectDest, pageBase, pageBase);
      if (!url) {
        note('warn', 'The redirect destination is not an address and no origin is known to resolve it against');
        obs.redirect = { loadId: null, ok: false, loadError: null, unresolved: true, state: null, url: null };
      } else {
        const L6 = await doLoad('redirect', 'Redirect destination', url, false);
        const r = { loadId: L6.id, ok: false, loadError: iaLoadFail(L6), state: null, url: qkMaskOutput(url) };
        if (!r.loadError) { r.ok = true; r.state = await read('Redirect destination', []); }
        obs.redirect = r;
      }
    }
    note('info', 'All steps of the ITW Activation run are done');
  }

  // ── Engine: reading a record (shared by iaRun and iaDeriveRows) ──────────
  function iaRes(status, observed, evidence, platform) { return { status: status, observed: observed, evidence: evidence, platform: platform === true }; }
  const iaPass = function (o, e) { return iaRes('passed', o, e); };
  const iaFail = function (o, e) { return iaRes('failed', o, e); };
  const iaPgm = function (o, e) { return iaRes('in-progress', o, e); };
  const iaMissing = function (t) { return iaRes('not-tested', '', 'Missing input: ' + t); };
  const iaOos = function (t) { return iaRes('not-tested', '', 'Out of scope: ' + t); };
  const iaBlocked = function (t) { return iaRes('blocked', '', 'Blocked: ' + t); };
  const iaNotRun = function (t) { return iaRes('not-tested', '', 'Not run: ' + t); };
  const iaPlatform = function (t) { return iaRes('not-tested', '', 'Needs the Optimizely UI: ' + t, true); };

  // The row of a step that was never observed, by why (D23 and the precedence of plan section 3.4).
  function iaAbsentRes(rec, why) {
    if (rec.halted) return iaBlocked('a bot check (' + (rec.halted.signal || 'challenge') + ') on ' + (rec.halted.path || '(no address)') + ' halted the run; it was never attempted.');
    if (rec.stopped) return iaRes('not-tested', '', 'Stopped: by the tester before this ran.');
    if (rec.error) return iaNotRun('the run ended on an error (' + String(rec.error).replace(/[.\s]+$/, '') + ').');
    return iaNotRun(why);
  }
  function iaStateText(s) {
    if (!s || s.readable === false) return 'state not read';
    if (s.platform == null) return 'no Optimizely snippet';
    if (s.activated) return 'active · ' + (s.variationName || s.variationId || 'variation unknown');
    const b = s.variationName || s.variationId;
    return 'not active' + (b ? ' (bucketed only: ' + b + ')' : '');
  }
  function iaVarText(s) { return (s && (s.variationName || s.variationId)) || 'a variation'; }
  function iaAlloc(rec) {
    const c = rec && rec.catalog;
    return !!(c && c.allocation && c.allocation.partial);
  }
  function iaAllocText(rec) { return rec.catalog.allocation.text + ' (as read from the snippet)'; }
  function iaLoadOf(rec, id) {
    const loads = (rec && rec.loads) || [];
    for (let i = 0; i < loads.length; i++) { if (loads[i] && loads[i].id === id) return loads[i]; }
    return null;
  }
  function iaUrlOf(rec, id) { const L = iaLoadOf(rec, id); return L ? L.url : ''; }
  function iaClearedText(names) { return names && names.length ? 'cleared ' + names.join(', ') : 'nothing needed clearing'; }
  // An observation that has a state but is unusable: its row, or null.
  function iaObsProblem(x, what) {
    if (x.loadError) return iaNotRun(what + ' did not load (' + x.loadError + ')');
    const s = x.state;
    if (!s || s.readable === false) return iaNotRun('the experiment state could not be read on ' + what + (s && s.error ? ' (' + s.error + ')' : ''));
    if (s.platform == null) return iaNotRun('no Optimizely snippet was found on ' + what);
    return null;
  }

  // Step 1 of a record: {kind:'absent'} | {kind:'bad', res} | {kind:'pass', state, res}.
  function iaBaseline(rec) {
    const b = rec.obs && rec.obs.baseline;
    if (!b) return { kind: 'absent' };
    if (b.loadError) return { kind: 'bad', res: iaNotRun('the ITW page did not load (' + b.loadError + ')') };
    const s = b.state;
    if (!s || s.readable === false) return { kind: 'bad', res: iaNotRun('the experiment state could not be read on the ITW page' + (s && s.error ? ' (' + s.error + ')' : '')) };
    if (s.platform == null) return { kind: 'bad', res: iaOos('no Optimizely snippet on the ITW page') };
    if (!s.experimentId) return { kind: 'bad', res: iaMissing('experiment ID (not typed, not on the ticket, and not derivable from the Control link\'s variation)') };
    if (!s.inSnippet) return { kind: 'bad', res: iaPlatform('experiment ' + s.experimentId + ' is not in this page\'s snippet (draft, paused, or another project)') };
    const act = rec.activation || {};
    return {
      kind: 'pass',
      state: s,
      res: iaPass(
        iaStateText(s) + ' · activation type ' + (act.type || s.activationType || 'unknown') + ' · page ' + (s.pageId || 'none'),
        [iaUrlOf(rec, b.loadId), 'activation type from ' + (act.source || 'nowhere'), iaClearedText(b.cleared)].join('; ')
      ),
    };
  }
  // Step 3's trigger, classified: {kind: 'na'|'missing'|'absent'|'already'|'covered'|'unsafe'|'not-found'|'not-visible'|
  // 'bad-selector'|'error'|'unreadable'|'pass'|'fail'|'foreign'|'alloc', click, state, polls}.
  function iaTriggerOf(rec) {
    const act = rec.activation || {};
    if (act.type !== 'trigger') return { kind: 'na' };
    if (!rec.input || !rec.input.triggerSelector) return { kind: 'missing' };
    const t = rec.obs && rec.obs.trigger;
    if (!t) return { kind: 'absent' };
    if (t.alreadyActive) return { kind: 'already' };
    const c = t.click || {};
    if (c.ok !== true) {
      const k = ['covered', 'unsafe', 'not-found', 'not-visible', 'bad-selector'].indexOf(c.reason) >= 0 ? c.reason : 'error';
      return { kind: k, click: c };
    }
    const s = t.state;
    if (!s || s.readable === false) return { kind: 'unreadable', click: c, state: s };
    if (s.activated) {
      const known = Array.isArray(s.variationIds) ? s.variationIds : [];
      if (!known.length || known.indexOf(String(s.variationId)) >= 0) return { kind: 'pass', click: c, state: s, polls: t.polls };
      return { kind: 'foreign', click: c, state: s, polls: t.polls };
    }
    return { kind: iaAlloc(rec) ? 'alloc' : 'fail', click: c, state: s, polls: t.polls };
  }
  // 'positive': the baseline activated (immediate, or the activation is not known) or the trigger passed.
  function iaPositive(rec) {
    const base = iaBaseline(rec);
    if (base.kind !== 'pass') return false;
    const act = rec.activation || {};
    if (act.type === 'trigger') return iaTriggerOf(rec).kind === 'pass';
    return base.state.activated === true;
  }
  // The state a returning or stay page must show: the variation of the activation (the trigger's, else the baseline's).
  function iaReferenceVariation(rec) {
    const act = rec.activation || {};
    if (act.type === 'trigger') { const t = iaTriggerOf(rec); return t.state ? t.state.variationId : null; }
    const base = iaBaseline(rec);
    return base.state ? base.state.variationId : null;
  }
  // Was the experiment active anywhere in the visitor's own flow (not Control, PROD or the redirect check)?
  function iaActivatedAnywhere(rec) {
    const o = rec.obs || {};
    const on = function (x) { return !!(x && x.state && x.state.activated === true); };
    return on(o.baseline) || on(o.trigger) || (o.stay || []).some(on) || on(o.returning) || (o.subPages || []).some(on)
      || ((o.audiences && o.audiences.items) || []).some(on);
  }

  // ── Engine: the rows (plan section 3.4) ──────────────────────────────────
  function iaDeriveRows(rec) {
    rec = rec && typeof rec === 'object' ? rec : {};
    const obs = rec.obs || {};
    const inp = rec.input || {};
    const act = rec.activation || { type: null, source: null, snippetType: null };
    const rows = [];
    const triggerMode = act.type === 'trigger';
    const base = iaBaseline(rec);
    const add = function (id, step, check, expected, res, loads) {
      rows.push(qkRow({
        id: id, step: String(step), check: check, expected: expected, observed: res.observed == null ? '' : res.observed,
        status: res.status, platform: res.platform === true, evidence: res.evidence, emulated: false, loads: loads || [], tile: null, extra: {},
      }));
    };
    // The common gate of the rows of steps 2 to 6: the halt wins over every other reason for a row that was never
    // observed; a baseline that did not read blocks the rest; null means go on.
    const gate = function (present) {
      if (!present && rec.halted) return iaAbsentRes(rec, '');
      if (base.kind === 'absent') return present ? null : iaAbsentRes(rec, 'the baseline did not run');
      if (base.kind === 'bad') return iaBlocked('the baseline did not read (ia.1.baseline)');
      return present ? null : iaAbsentRes(rec, 'this step did not run');
    };
    const noSelector = function () { return iaMissing('trigger selector (the spec says: ' + (inp.triggerDescription || 'nothing') + ')'); };
    const alloc = iaAlloc(rec);
    const trig = iaTriggerOf(rec);
    const positive = iaPositive(rec);

    if (rec.refusedItw) {
      add('ia.itw.refused', 1, 'Audience and activation checks on the ITW link', 'a plain ITW link', iaOos('the ITW link forces a variation (optimizely_x). A forced preview link bypasses audience conditions, so audience and activation checks run on the plain ITW link only. Give the ITW link without optimizely_x.'));
    } else if (!inp.itwUrl) {
      add('ia.itw.missing', 1, 'Audience and activation checks on the ITW link', 'a plain ITW link', iaMissing('ITW link (Initialize, or the ITW link field above)'));
    } else {
      // ia.1 baseline
      const b = obs.baseline;
      add('ia.1.baseline', 1, 'Baseline on the ITW link (clean visitor)', 'the experiment\'s state reads on the ITW page (state list and data)',
        base.kind === 'absent' ? iaAbsentRes(rec, 'the baseline did not run') : base.res, b ? [b.loadId] : []);

      // ia.2.onload
      const onloadCheck = triggerMode ? 'Not active on page load' : (act.type === 'immediate' ? 'Active on page load' : 'Activation on page load');
      const onloadExpected = triggerMode ? 'not active on load (it waits for its trigger)' : (act.type === 'immediate' ? 'active on load' : 'depends on the activation type');
      let res;
      if (!act.type) res = iaMissing('activation type (on page load or on a trigger)');
      else {
        res = gate(!!obs.baseline);
        if (!res) {
          const s = base.state;
          const url = iaUrlOf(rec, obs.baseline.loadId);
          if (triggerMode) {
            if (s.activated) {
              res = iaFail(iaStateText(s), 'Active on page load although the experiment should wait for its trigger. Activation type came from ' + (act.source || 'nowhere') + '; the snippet\'s type is ' + (act.snippetType || 'unknown') + '. ' + url);
            } else if (!positive) {
              res = iaPgm(iaStateText(s), 'Not active on load, but the trigger did not activate it in this run (ia.3.trigger), so this may be a broken experiment rather than one that waits for its trigger. ' + url);
            } else res = iaPass(iaStateText(s), 'Not active on load, as expected for a trigger. ' + url);
          } else if (s.activated) {
            res = iaPass(iaStateText(s), 'Active on page load. ' + url);
          } else if (alloc) {
            res = iaPgm(iaStateText(s), 'Not active on page load, and ' + iaAllocText(rec) + ': a visitor outside the allocation is expected not to see it. ' + url);
          } else res = iaFail(iaStateText(s), 'Not active on page load although the experiment activates on load. ' + url);
        }
      }
      add('ia.2.onload', 2, onloadCheck, onloadExpected, res, obs.baseline ? [obs.baseline.loadId] : []);

      // ia.2.sub.<n>
      const subs = Array.isArray(inp.subPages) ? inp.subPages : [];
      subs.slice(0, IA_MAX_SUBPAGES).forEach(function (page, i) {
        const e = (obs.subPages || [])[i];
        let r;
        if (e && e.unresolved) r = iaMissing('an address for sub-page ' + page + ' (a full URL, or a /path with an ITW link to take the origin from)');
        else {
          r = gate(!!e);
          if (!r) {
            r = iaObsProblem(e, 'the sub-page ' + page);
            if (!r) {
              const url = iaUrlOf(rec, e.loadId);
              const cl = iaClearedText(rec.loads && iaLoadOf(rec, e.loadId) ? iaLoadOf(rec, e.loadId).cleared : null);
              if (e.state.activated) r = iaFail(iaStateText(e.state), 'Active on a sub-page where it must not activate on load. ' + url);
              else if (!positive) r = iaPgm(iaStateText(e.state), 'Not active here, but the experiment never activated on the ITW flow in this run (ia.' + (triggerMode ? '3.trigger' : '2.onload') + '), so a missing activation here proves nothing. ' + url);
              else r = iaPass(iaStateText(e.state), 'Not active on this sub-page. ' + url + '; ' + cl);
            }
          }
        }
        add('ia.2.sub.' + (i + 1), 2, 'Not active on load: ' + page, 'not active', r, e && e.loadId ? [e.loadId] : []);
      });
      if (subs.length > IA_MAX_SUBPAGES) {
        add('ia.2.sub.capped', 2, 'Sub-pages over the cap', 'every sub-page is checked',
          iaOos((subs.length - IA_MAX_SUBPAGES) + ' sub-page(s) over the cap of ' + IA_MAX_SUBPAGES + ' were not run (' + subs.slice(IA_MAX_SUBPAGES).join(', ') + ')'));
      }

      // ia.3.trigger
      if (triggerMode) {
        let r;
        if (trig.kind === 'missing') r = noSelector();
        else {
          r = gate(!!obs.trigger);
          if (!r) {
            const sel = inp.triggerSelector;
            const c = trig.click || {};
            const where = 'the ITW page';
            if (trig.kind === 'already') r = iaPgm('already active before the click', 'Already active before the click (ia.2.onload), so activation by the trigger cannot be shown.');
            else if (trig.kind === 'covered') r = iaBlocked('the trigger is covered by ' + (c.coveredBy || 'something on top') + ' at every point tried; nothing was clicked.');
            else if (trig.kind === 'unsafe') r = iaBlocked('the trigger ' + (c.label || sel) + ' reads like a purchase, account or delete control; Selenite never clicks those. Check it by hand.');
            else if (trig.kind === 'not-found') r = iaPgm('the selector matches nothing', 'the trigger selector matches nothing on ' + where + ': check it with the developer');
            else if (trig.kind === 'not-visible') r = iaPgm('the trigger is not visible', 'the trigger ' + (c.label || sel) + ' is on ' + where + ' but not visible: check it with the developer');
            else if (trig.kind === 'bad-selector') r = iaMissing('a valid CSS selector for the trigger (' + (c.error || 'not valid') + ')');
            else if (trig.kind === 'error') r = iaNotRun('the click failed (' + (c.error || c.reason || 'no result') + ')');
            else if (trig.kind === 'unreadable') r = iaNotRun('the experiment state could not be read after the click');
            else if (trig.kind === 'pass') {
              r = iaPass(iaStateText(trig.state), 'Active after one trusted click on ' + sel + ' (' + trig.polls + ' state read(s)); clicked ' + (c.label || 'the trigger') + '.');
            } else if (trig.kind === 'foreign') {
              r = iaFail(iaStateText(trig.state), 'Active after the click, but with variation ' + iaVarText(trig.state) + ', which is not one of the experiment\'s (' + (trig.state.variationIds || []).join(', ') + ').');
            } else if (trig.kind === 'alloc') {
              r = iaPgm(iaStateText(trig.state), 'Not active after the click and ' + trig.polls + ' state read(s); ' + iaAllocText(rec) + ', so a visitor outside the allocation is expected not to see it.');
            } else r = iaFail(iaStateText(trig.state), 'Not active after the click on ' + sel + ' and ' + trig.polls + ' state read(s).');
          }
        }
        add('ia.3.trigger', 3, 'Activates on its trigger', 'active after one trusted click on ' + (inp.triggerSelector || 'the trigger') + ', with one of the experiment\'s variations', r, []);
      }

      // ia.3.stay.<n>
      const stays = Array.isArray(inp.stayActive) ? inp.stayActive : [];
      stays.slice(0, IA_MAX_STAY).forEach(function (page, i) {
        const e = (obs.stay || [])[i];
        let r;
        if (e && e.unresolved) r = iaMissing('an address for stay page ' + page + ' (a full URL, or a /path with an ITW link to take the origin from)');
        else if (!e && base.kind === 'pass' && !positive && !rec.halted) {
          r = triggerMode ? iaBlocked('the trigger did not activate the experiment (ia.3.trigger)')
            : iaBlocked('the experiment was not active on the ITW page, so there is nothing to stay active (ia.2.onload)');
        } else {
          r = gate(!!e);
          if (!r) {
            r = iaObsProblem(e, 'the stay page ' + page);
            if (!r) {
              const url = iaUrlOf(rec, e.loadId);
              const ref = iaReferenceVariation(rec);
              if (!e.state.activated) r = iaFail(iaStateText(e.state), 'Not active on ' + page + ' after being active on the ITW page. ' + url);
              else if (ref != null && String(e.state.variationId) !== String(ref)) r = iaFail(iaStateText(e.state), 'Active, but with variation ' + iaVarText(e.state) + ' instead of the one seen on the ITW page (' + ref + '). ' + url);
              else r = iaPass(iaStateText(e.state), 'Still active with the same variation. ' + url);
            }
          }
        }
        add('ia.3.stay.' + (i + 1), 3, 'Stays active on ' + page, 'active, same variation', r, e && e.loadId ? [e.loadId] : []);
      });
      if (stays.length > IA_MAX_STAY) {
        add('ia.3.stay.capped', 3, 'Stay pages over the cap', 'every stay page is checked',
          iaOos((stays.length - IA_MAX_STAY) + ' stay page(s) over the cap of ' + IA_MAX_STAY + ' were not run (' + stays.slice(IA_MAX_STAY).join(', ') + ')'));
      }

      // ia.4.returning
      {
        const e = obs.returning;
        let r;
        if (!inp.returning) r = iaMissing('what a returning visitor sees (the spec\'s returning-visitor behaviour)');
        else if (base.kind === 'pass' && !e && !positive && !rec.halted) r = iaBlocked('no activation earlier in this run, so there is no returning visitor to test');
        else {
          r = gate(!!e);
          if (!r) {
            r = iaObsProblem(e, 'the returning-visitor reload');
            if (!r) {
              const st = e.storage && !e.storage.error ? e.storage : { local: [], session: [], cookies: [] };
              const names = (st.local || []).map(function (n) { return 'local:' + n; }).concat((st.session || []).map(function (n) { return 'session:' + n; }), (st.cookies || []).map(function (n) { return 'cookie:' + n; }));
              const appNames = names.filter(function (n) { return !/^[a-z]+:optimizely/i.test(n); });
              const listed = Array.isArray(inp.storedKeys) && inp.storedKeys.length > 0;
              const seen = 'Stored before the reload: ' + (names.length ? names.join(', ') : 'nothing') + (listed && !appNames.length ? ' (none of the listed keys was in storage)' : '') + '.';
              const url = iaUrlOf(rec, e.loadId);
              const ref = iaReferenceVariation(rec);
              if (inp.returning === 'active') {
                if (!e.state.activated) r = iaFail(iaStateText(e.state), 'Not active for the returning visitor. ' + seen + ' ' + url);
                else if (ref != null && String(e.state.variationId) !== String(ref)) r = iaFail(iaStateText(e.state), 'Active, but with variation ' + iaVarText(e.state) + ' instead of ' + ref + '. ' + seen + ' ' + url);
                else r = iaPass(iaStateText(e.state), 'Active again with the same variation. ' + seen + ' ' + url);
              } else if (e.state.activated) r = iaFail(iaStateText(e.state), 'Active for the returning visitor, who should not see it. ' + seen + ' ' + url);
              else r = iaPass(iaStateText(e.state), 'Not active for the returning visitor. ' + seen + ' ' + url);
            }
          }
        }
        add('ia.4.returning', 4, 'Returning visitor (reload with stored state)', inp.returning === 'inactive' ? 'not active' : 'active, same variation', r, e && e.loadId ? [e.loadId] : []);
      }

      // ia.5.*
      const aud = obs.audiences || { source: 'none', items: [], capped: [], notExercised: [] };
      const items = Array.isArray(aud.items) ? aud.items : [];
      const itemObs = function (it) {
        if (it.missing) return { res: iaMissing(it.missing) };
        if (it.scope) return { res: iaOos(it.scope) };
        if (triggerMode && !inp.triggerSelector) return { res: noSelector() };
        if (it.skipLoad) {
          const g1 = gate(base.kind !== 'absent');
          return g1 ? { res: g1 } : { carried: true };
        }
        const g2 = gate(it.loadId != null);
        if (g2) return { res: g2 };
        if (it.loadError) return { res: iaNotRun('the page did not load (' + it.loadError + ')') };
        if (triggerMode && it.click && it.click.ok !== true) {
          const rs = it.click.reason || 'no result';
          if (rs === 'not-found') return { res: iaPgm('the selector matches nothing', 'the trigger selector matches nothing on this page: check it with the developer') };
          return { res: iaBlocked('the trigger could not be clicked on this load (' + rs + ')') };
        }
        const s = it.state;
        if (!s || s.readable === false) return { res: iaAbsentRes(rec, 'the experiment state could not be read' + (s && s.error ? ' (' + s.error + ')' : '')) };
        if (s.platform == null) return { res: iaNotRun('no Optimizely snippet was found on this page') };
        return { s: s };
      };
      const partnerOf = function (it) {
        const want = it.kind === 'excl' ? 'comp' : 'with';
        for (let i = 0; i < items.length; i++) { if (items[i].n === it.n && items[i].kind === want) return items[i]; }
        return null;
      };
      const evalPositive = function (it) {
        const o = itemObs(it);
        if (o.res) return o.res;
        const url = it.loadId ? iaUrlOf(rec, it.loadId) : '';
        if (o.carried) {
          if (positive) return iaPass('active (the ITW link already carries ' + it.param + '=' + it.value + ')', 'The ITW link already carries ' + it.param + '=' + it.value + ', so the activation checked above is this check.');
          if (triggerMode && ['pass', 'fail', 'alloc'].indexOf(trig.kind) < 0) return iaBlocked('activation could not be exercised on the ITW link (ia.3.trigger)');
          return alloc ? iaPgm('not active', 'Not active on the ITW link, which already carries ' + it.param + '=' + it.value + '; ' + iaAllocText(rec) + '.')
            : iaFail('not active', 'Not active on the ITW link, which already carries ' + it.param + '=' + it.value + '.');
        }
        if (o.s.activated) return iaPass(iaStateText(o.s), 'Active, as expected. ' + url);
        return alloc ? iaPgm(iaStateText(o.s), 'Not active; ' + iaAllocText(rec) + ', so a visitor outside the allocation is expected not to see it. ' + url)
          : iaFail(iaStateText(o.s), 'Not active although this visitor should see the experiment. ' + url);
      };
      const evalNegative = function (it) {
        const o = itemObs(it);
        if (o.res) return o.res;
        const url = it.loadId ? iaUrlOf(rec, it.loadId) : '';
        if (o.s.activated) return iaFail(iaStateText(o.s), 'Active, but the spec says this visitor must not be in the experiment. ' + url);
        const partner = partnerOf(it);
        const pr = partner ? evalPositive(partner) : null;
        if (pr && pr.status === 'passed') return iaPass(iaStateText(o.s), 'Not active, and its positive partner (' + partner.id + ') passed. ' + url);
        return iaPgm(iaStateText(o.s), 'Not active, but its positive partner (' + (partner ? partner.id : 'not run') + ') did not pass, so this may only mean the page never activates for this visitor. ' + url);
      };
      const itemChecks = {
        excl: function (it) { return ['ITW with ' + it.param + '=' + it.value + ' (excluded)', 'not active']; },
        comp: function (it) { return ['ITW with ' + it.param + '=' + QK_COMPANION_VALUE + ' (not excluded)', 'active']; },
        without: function (it) { return ['ITW without ' + it.param, 'not active']; },
        with: function (it) { return ['ITW with ' + it.param + '=' + it.value, 'active']; },
        other: function (it) { return ['Audience ' + (it.name || it.param || 'unnamed'), 'as the spec says']; },
      };
      items.filter(function (it) { return it.kind !== 'device'; }).forEach(function (it) {
        const ce = (itemChecks[it.kind] || itemChecks.other)(it);
        const r = it.kind === 'excl' || it.kind === 'without' ? evalNegative(it) : (it.kind === 'other' ? itemObs(it).res || iaOos('this audience cannot be tested') : evalPositive(it));
        add(it.id, 5, ce[0], ce[1], r, it.loadId ? [it.loadId] : []);
      });
      const capped = Array.isArray(aud.capped) ? aud.capped : [];
      if (capped.length) {
        const n = capped.reduce(function (a, c) { return a + (c.loads || 0); }, 0);
        add('ia.5.capped', 5, 'Audience tests over the cap', 'every audience is tested',
          iaOos(n + ' audience load(s) over the cap of ' + IA_MAX_AUDIENCE_LOADS + ' were not run (' + capped.map(function (c) { return c.name; }).join(', ') + ')'));
      }
      if (aud.source === 'none') {
        const ne = Array.isArray(aud.notExercised) ? aud.notExercised : [];
        const why = !rec.catalog ? 'none on the ticket; the snippet was not read'
          : (ne.length ? 'none on the ticket; the snippet\'s conditions cannot be set from the URL: ' + ne.map(function (x) { return (x.audienceName || x.audienceId || 'everyone else') + ' (' + x.reason + ')'; }).join('; ')
            : 'none on the ticket and none in the snippet');
        add('ia.5.none', 5, 'Audience tests', 'the spec\'s audiences are tested', iaMissing('spec audiences (' + why + ')'));
      }

      // ia.6.*
      items.filter(function (it) { return it.kind === 'device'; }).forEach(function (it) {
        const label = it.value === 'desktop' ? 'Desktop Only' : 'Mobile Only';
        let r;
        r = gate(base.kind !== 'absent');
        if (!r) {
          if (it.value === 'desktop') {
            if (positive) r = iaPass('active on desktop Chrome', 'Active on desktop Chrome at ' + QK_PHASE_WIDTH + ' px (' + (triggerMode ? 'ia.3.trigger' : 'ia.2.onload') + ').');
            else if (triggerMode && ['pass', 'fail', 'alloc'].indexOf(trig.kind) < 0) r = iaBlocked('activation could not be exercised on desktop (ia.3.trigger)');
            else r = alloc ? iaPgm('not active', 'Not active on desktop Chrome; ' + iaAllocText(rec) + '.') : iaFail('not active', 'Not active on desktop Chrome although the audience is Desktop Only.');
          } else if (iaActivatedAnywhere(rec)) r = iaFail('active on desktop Chrome', 'Active on desktop Chrome although the audience is Mobile Only.');
          else r = iaPgm('not active on desktop Chrome', 'Not active on desktop Chrome, but the phone half cannot run here (phone emulation, out of scope for now), so Mobile Only is not shown to work.');
        }
        add('ia.6.' + it.value + '.desktop', 6, label + ': ' + (it.value === 'desktop' ? 'active' : 'not active') + ' on desktop Chrome', it.value === 'desktop' ? 'active' : 'not active', r, []);
        add('ia.6.' + it.value + '.phone', 6, label + ': the phone half', it.value === 'desktop' ? 'not active on a phone' : 'active on a phone', iaOos('phone emulation, out of scope for now'), []);
      });
    }

    // ia.7 Control equals PROD
    {
      const ctl = obs.control, prd = obs.prod;
      if (!inp.controlUrl) {
        add('ia.7.control', 7, 'Control equals PROD', 'same page as PROD', iaMissing('Control link (the v0 preview link)'));
      } else {
        const CMP = [
          ['title', 'title', 'same title as PROD'],
          ['canonical', 'canonical', 'same canonical path as PROD'],
          ['textLen', 'text length', 'text length within 1 % (or 50 characters) of PROD'],
          ['height', 'page height', 'page height within 2 % (or 40 px) of PROD'],
          ['widgets', 'widgets', 'same chat, banner and modal widgets as PROD'],
          ['textHash', 'text hash', 'same normalised text as PROD'],
        ];
        const factsOk = function (f) { return !!f && !f.error; };
        let pre = null;
        const controlId = ctl && Array.isArray(ctl.forcedIds) && ctl.forcedIds.length ? String(ctl.forcedIds[0]) : null;
        if (ctl && ctl.convForced) pre = iaBlocked('the Control link forces with _conv_eforce, which this mode never loads');
        else if (!ctl) pre = iaAbsentRes(rec, 'the Control page did not run');
        else if (ctl.loadError) pre = iaNotRun('the Control page did not load (' + ctl.loadError + ')');
        else if (!ctl.state || ctl.state.readable === false) pre = iaNotRun('the experiment state could not be read on the Control page' + (ctl.state && ctl.state.error ? ' (' + ctl.state.error + ')' : ''));
        else if (ctl.state.servedForced === false) pre = iaBlocked('the Control link did not serve the control variation ' + (controlId || '') + ' without optimizely_force_tracking, which this mode never loads');
        else if (!prd) pre = iaAbsentRes(rec, 'the PROD page did not run');
        else if (prd.loadError) pre = iaNotRun('the PROD page did not load (' + prd.loadError + ')');
        else if (!prd.state || prd.state.readable === false) pre = iaNotRun('the experiment state could not be read on the PROD page' + (prd.state && prd.state.error ? ' (' + prd.state.error + ')' : ''));
        else if (prd.state.activated === true && controlId && String(prd.state.variationId) !== controlId) {
          pre = iaBlocked('PROD put this visitor in "' + (prd.state.variationName || prd.state.variationId) + '" (' + prd.state.variationId + '), not Control, so the comparison would mix in a variant');
        } else if (!factsOk(ctl.facts) || !factsOk(prd.facts)) pre = iaNotRun('the page facts could not be read on ' + (!factsOk(ctl.facts) ? 'the Control page' : 'the PROD page'));
        const loads = [ctl && ctl.loadId, prd && prd.loadId].filter(Boolean);
        let cmp = null;
        let tail = '';
        if (!pre) {
          cmp = qkCompareFacts(ctl.facts, prd.facts);
          const cl = iaLoadOf(rec, ctl.loadId), pl = iaLoadOf(rec, prd.loadId);
          tail = 'Control ' + ((cl && cl.path) || '') + '; PROD ' + ((pl && (pl.final && qkPathOnly(pl.final) ? pl.final : pl.path)) || '')
            + (prd.finalHost && prd.requestedHost && prd.finalHost !== prd.requestedHost ? '; PROD redirected to ' + prd.finalHost + '; compared there' : '');
        }
        const diff = function (field) { return cmp ? cmp.diffs.filter(function (d) { return d.field === field; })[0] || null : null; };
        const lenFail = !!diff('textLen');
        CMP.forEach(function (c) {
          let r;
          if (pre) r = pre;
          else {
            const cf = ctl.facts, pf = prd.facts;
            if (c[0] === 'title') {
              const d = diff('title');
              r = d ? iaFail('Control "' + d.control + '", PROD "' + d.prod + '"', 'The titles differ. ' + tail + ' ' + IA_CONTROL_REMEDY) : iaPass('"' + cf.title + '"', 'Same title. ' + tail);
            } else if (c[0] === 'canonical') {
              const d = diff('canonical');
              r = d ? iaFail('Control ' + d.control + ', PROD ' + d.prod, 'The canonical paths differ. ' + tail + ' ' + IA_CONTROL_REMEDY) : iaPass((cf.canonical || 'none') + ' / ' + (pf.canonical || 'none'), 'Same canonical path (or none to compare). ' + tail);
            } else if (c[0] === 'textLen') {
              const d = diff('textLen');
              r = d ? iaFail('Control ' + d.control + ' characters, PROD ' + d.prod, 'The text length differs beyond the tolerance. ' + tail + ' ' + IA_CONTROL_REMEDY) : iaPass('Control ' + cf.textLen + ' characters, PROD ' + pf.textLen, 'Text length within tolerance. ' + tail);
            } else if (c[0] === 'height') {
              const d = diff('scrollHeight');
              r = d ? iaFail('Control ' + d.control + ' px, PROD ' + d.prod + ' px', 'The page height differs beyond the tolerance. ' + tail + ' ' + IA_CONTROL_REMEDY) : iaPass('Control ' + cf.scrollHeight + ' px, PROD ' + pf.scrollHeight + ' px', 'Page height within tolerance. ' + tail);
            } else if (c[0] === 'widgets') {
              const ds = cmp.diffs.filter(function (d) { return /^widgets\./.test(d.field); });
              const wtxt = 'chat/banner/modal: Control ' + [cf.widgets.chat, cf.widgets.banner, cf.widgets.modal].join('/') + ', PROD ' + [pf.widgets.chat, pf.widgets.banner, pf.widgets.modal].join('/');
              r = ds.length ? iaFail(wtxt, 'A widget is present on one page only (' + ds.map(function (d) { return d.field.replace('widgets.', ''); }).join(', ') + '). ' + tail + ' ' + IA_CONTROL_REMEDY) : iaPass(wtxt, 'The same widgets on both pages. ' + tail);
            } else if (!cf.textHash || !pf.textHash) r = iaNotRun('the normalised text hash could not be read');
            else if (cmp.identicalText) r = iaPass('identical text', 'The normalised text is identical. ' + tail);
            else if (lenFail) r = iaFail('the text differs', 'The normalised text differs and the text length row failed. ' + tail + ' ' + IA_CONTROL_REMEDY);
            else r = iaPgm('the text differs, its length does not', 'The normalised text differs byte for byte while its length is within tolerance; rotating or personalised copy can cause this, so check it by eye. ' + tail);
          }
          add('ia.7.' + c[0], 7, 'Control equals PROD: ' + c[1], c[2], r, loads);
        });
      }
    }

    // ia.8 redirect
    {
      const r8 = obs.redirect;
      let r;
      const check = 'Direct visitor to the redirect destination';
      const expected = 'not in the experiment (Control there would render the destination page, not PROD)';
      if (!inp.redirectDest) r = iaMissing('redirect destination URL (only for a redirect test)');
      else if (r8 && r8.unresolved) r = iaMissing('an address for the redirect destination (a full URL, or a /path with an ITW or Control link to take the origin from)');
      else if (!r8) r = iaAbsentRes(rec, 'the redirect destination did not run');
      else if (!rec.experimentId) r = iaMissing('experiment ID (needed to tell whether the destination puts a visitor in the experiment)');
      else {
        r = iaObsProblem(r8, 'the redirect destination');
        if (!r) {
          const s = r8.state;
          const url = iaUrlOf(rec, r8.loadId);
          if (s.activated) r = iaFail(iaStateText(s), 'Active on the destination page for a visitor who landed there directly. ' + url + ' ' + IA_REDIRECT_REMEDY);
          else if (s.variationId || s.variationName) r = iaPgm(iaStateText(s), 'Bucketed into the experiment on the destination page without being active: check with the developer whether that counts. ' + url);
          else r = iaPass(iaStateText(s), 'Not in the experiment on the destination page. ' + url);
        }
      }
      add('ia.8.redirect', 8, check, expected, r, r8 && r8.loadId ? [r8.loadId] : []);
    }
    return rows;
  }

  // ── Engine: projections and the report foot ──────────────────────────────
  // What the AI summary sees: counts and the rows, non-Pass first (no images, no URLs beyond masked paths).
  function iaSummaryProjection(rec) {
    rec = rec && typeof rec === 'object' ? rec : {};
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    return {
      stopped: !!rec.stopped,
      halted: rec.halted ? qkMaskDeep(rec.halted) : null,
      error: rec.error ? qkMaskOutput(rec.error) : null,
      counts: qkCounts(rows),
      rows: qkSortRows(rows).slice(0, 40).map(function (r) {
        return { id: r.id, verdict: qkVerdictLabel(r), check: qkMaskOutput(r.check), observed: qkMaskOutput(r.observed).slice(0, 160) };
      }),
    };
  }
  function iaDebugProjection(rec) {
    return qkMaskDeep(rec);
  }
  // The pages loaded (by where they ended up, no query), the fresh-visitor count and the desktop-only line, as escaped HTML.
  function iaReportFootHtml(rec) {
    rec = rec && typeof rec === 'object' ? rec : {};
    const seen = [];
    (rec.loads || []).forEach(function (L) {
      const p = L && (L.final && qkPathOnly(L.final) ? L.final : L.path);
      const t = p ? qkMaskOutput(p) : '';
      if (t && seen.indexOf(t) < 0) seen.push(t);
    });
    return qkEsc('Pages loaded: ' + (seen.length ? seen.join(', ') : 'none') + '.') + ' '
      + qkEsc(qkFreshText(qkFreshCount(rec.loads))) + ' '
      + qkEsc('Desktop Chrome at 1440 px. No phone user agent or touch: device audiences are checked for the desktop half only.');
  }

  const IA_ENGINE = {
    mode: IA_MODE,
    label: IA_LABEL,
    version: IA_RECORD_VERSION,
    sanitize: iaSanitizeInput,
    newRecord: iaNewRecord,
    run: iaRun,
    derive: iaDeriveRows,
  };

  Object.assign(EXPORTS, {
    iaSanitizeInput, iaMaskInput, iaNewRecord, iaCatalogSlice, iaActivationUsed, iaAudiencePlan, iaPollActive, iaRun,
    iaDeriveRows, iaSummaryProjection, iaDebugProjection, iaReportFootHtml, IA_ENGINE,
  });

  Object.keys(EXPORTS).forEach(function (k) { g[k] = EXPORTS[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : this);
