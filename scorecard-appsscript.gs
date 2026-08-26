// CW Ops Scorecard - data service
// Reads and writes the Google Sheet "CW Ops Scorecard".
//
// Serves the scorecard page at citywidelv.github.io/scorecard.html and pulls
// its own data from Dynamics on a 15 minute timer.
//
// No passcode is stored here. Callers send the team passcode and this script
// checks it against the existing CW Solicitations auth endpoint, so there is
// one passcode in one place.
//
// Script Properties (Project Settings, never in code):
//   TENANT_ID       Entra tenant id, GoCityWide. Not a secret.
//   CLIENT_ID       app registration (client) id. Not a secret.
//   CLIENT_SECRET   client secret value. SECRET, TJ sets this.
//   REFRESH_TOKEN   written automatically by exchangeCode(), then kept fresh.
//   ORG_NNV         Northern Nevada org url, blank until we have it.

var SHEET_ID = '1gO-A9EroWxdmvdH2b7JlDWBWLHjZok71dFIlpQC3tbU';
var SP = PropertiesService.getScriptProperties();
var SS = SpreadsheetApp.openById(SHEET_ID);

var ORG_LV = 'https://gocitywide.crm.dynamics.com';
var AUTH_HOOK = 'https://script.google.com/macros/s/AKfycbzfNnrpidCbWB1DeUNgXvRhDFMQgApfpn-3C9GU45wMEHcJpWFl8ZQVo6PUBSRfEVfRdg/exec';

//  Validates the team passcode against the Team Portal's own auth endpoint.
function authOk_(passcode) {
  if (!passcode) return false;
  var cache = CacheService.getScriptCache();
  var key = 'auth:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, passcode));
  if (cache.get(key) === '1') return true;
  try {
    var res = UrlFetchApp.fetch(AUTH_HOOK, {
      method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
      payload: JSON.stringify({ kind: 'auth', passcode: passcode })
    });
    var b = JSON.parse(res.getContentText());
    if (b && b.ok) { cache.put(key, '1', 300); return true; }
  } catch (err) {}
  return false;
}

var TABS = {
  facts: 'Facts',
  route: 'Route',
  pipeline: 'Pipeline',
  field: 'Field',
  goals: 'Goals',
  roster: 'Roster',
  log: 'Refresh Log'
};

var HEADERS = {
  Facts:    ['fact_id', 'date', 'territory', 'person', 'type', 'count', 'amount', 'rating_customer', 'rating_fsm'],
  Route:    ['territory', 'person', 'accounts', 'agreement_lines', 'monthly_value', 'expected_inspections'],
  Pipeline: ['territory', 'person', 'quotes', 'quote_value', 'quotes_expired', 'wo_lines', 'wo_value', 'wo_expired'],
  Field:    ['territory', 'person', 'neglected_21d', 'open_cases', 'star_accounts'],
  Goals:    ['territory', 'person', 'metric', 'basis', 'value', 'effective_from', 'notes'],
  Roster:   ['territory', 'person', 'role', 'crm_fsm_name', 'sort_order', 'active'],
  'Refresh Log': ['when', 'source', 'status', 'facts_written', 'detail']
};

//  ---------------------------------------------------------------- setup

function setup() {
  Object.keys(HEADERS).forEach(function (name) {
    var sh = SS.getSheetByName(name) || SS.insertSheet(name);
    var want = HEADERS[name];
    var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (have.join('|') !== want.join('|')) {
      sh.getRange(1, 1, 1, want.length).setValues([want]);
    }
    sh.getRange(1, 1, 1, want.length).setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  });
  var d = SS.getSheetByName('Sheet1');
  if (d && SS.getSheets().length > 1) SS.deleteSheet(d);
  // The editor's Run picker often ignores the selected function and runs this
  // one, so seed here when the Roster tab is still empty. Idempotent.
  var seeded = 'roster already populated';
  if (SS.getSheetByName(TABS.roster).getLastRow() < 2) seeded = seedRosterAndGoals();
  return 'setup ok, ' + seeded;
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshFromCrm') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshFromCrm').timeBased().everyMinutes(15).create();
  return 'trigger installed, every 15 minutes';
}

//  ------------------------------------------------------------ web entry

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!authOk_(p.passcode)) return json_({ ok: false, error: 'unauthorized' });
  try {
    return json_({ ok: true, data: buildFeed_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }

  if (body.kind === 'scorecard_push') {
    if (!authOk_(body.passcode)) return json_({ ok: false, error: 'unauthorized' });
    try {
      var n = applySnapshot_(body.payload, 'push');
      return json_({ ok: true, wrote: n });
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }
  return json_({ ok: false, error: 'unknown kind' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

//  --------------------------------------------------------------- feed

function rows_(name) {
  var sh = SS.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS[name].length).getValues();
  var head = HEADERS[name];
  return vals.filter(function (r) { return String(r[0]).length || String(r[1]).length; })
    .map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function buildFeed_() {
  var facts = rows_(TABS.facts).map(function (f) {
    return {
      d: ymd_(f.date),
      t: String(f.territory || ''),
      p: String(f.person || ''),
      k: String(f.type || ''),
      n: Number(f.count) || 0,
      a: Number(f.amount) || 0,
      rc: f.rating_customer === '' || f.rating_customer === null ? null : Number(f.rating_customer),
      rf: f.rating_fsm === '' || f.rating_fsm === null ? null : Number(f.rating_fsm)
    };
  });
  return {
    generated: new Date().toISOString(),
    lastRefresh: lastRefresh_(),
    roster: rows_(TABS.roster).filter(function (r) { return r.active !== false && String(r.active).toLowerCase() !== 'no'; }),
    goals: rows_(TABS.goals).map(function (g) { g.effective_from = ymd_(g.effective_from); return g; }),
    route: rows_(TABS.route),
    pipeline: rows_(TABS.pipeline),
    field: rows_(TABS.field),
    facts: facts
  };
}

function lastRefresh_() {
  var sh = SS.getSheetByName(TABS.log);
  if (!sh || sh.getLastRow() < 2) return null;
  var r = sh.getRange(sh.getLastRow(), 1, 1, 5).getValues()[0];
  return { when: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), source: r[1], status: r[2], facts: r[3] };
}

//  --------------------------------------------------- snapshot ingestion

// payload = { facts:[...], route:[...], pipeline:[...], field:[...] }
// Facts are upserted on fact_id so a re-run never duplicates.
// Route, Pipeline and Field are full replacements, they are point in time.
function applySnapshot_(payload, source) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var wrote = 0;
    if (payload.facts && payload.facts.length) wrote = upsertFacts_(payload.facts);
    ['route', 'pipeline', 'field'].forEach(function (k) {
      if (payload[k]) replaceTab_(TABS[k], payload[k]);
    });
    log_(source, 'ok', wrote, payload.detail || '');
    return wrote;
  } catch (err) {
    log_(source, 'error', 0, String(err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function upsertFacts_(facts) {
  var name = TABS.facts, head = HEADERS[name];
  var sh = SS.getSheetByName(name);
  var last = sh.getLastRow();
  var existing = last > 1 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];
  var index = {};
  existing.forEach(function (r, i) { index[String(r[0])] = i; });

  facts.forEach(function (f) {
    var row = head.map(function (h) { return f[h] === undefined || f[h] === null ? '' : f[h]; });
    var id = String(f.fact_id);
    if (id in index) existing[index[id]] = row;
    else { index[id] = existing.length; existing.push(row); }
  });

  if (existing.length) sh.getRange(2, 1, existing.length, head.length).setValues(existing);
  return facts.length;
}

function replaceTab_(name, list) {
  var head = HEADERS[name];
  var sh = SS.getSheetByName(name);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
  if (!list.length) return;
  var vals = list.map(function (o) {
    return head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; });
  });
  sh.getRange(2, 1, vals.length, head.length).setValues(vals);
}

function log_(source, status, n, detail) {
  var sh = SS.getSheetByName(TABS.log);
  sh.appendRow([new Date(), source, status, n, String(detail).slice(0, 500)]);
  if (sh.getLastRow() > 500) sh.deleteRows(2, 200);
}

//  ------------------------------------------------------- dynamics pull

function token_() {
  var rt = SP.getProperty('REFRESH_TOKEN');
  if (!rt) throw new Error('REFRESH_TOKEN not set, run the one time authorize step');
  var res = UrlFetchApp.fetch(
    'https://login.microsoftonline.com/' + SP.getProperty('TENANT_ID') + '/oauth2/v2.0/token',
    {
      method: 'post',
      muteHttpExceptions: true,
      payload: {
        client_id: SP.getProperty('CLIENT_ID'),
        client_secret: SP.getProperty('CLIENT_SECRET'),
        grant_type: 'refresh_token',
        refresh_token: rt,
        scope: ORG_LV + '/.default offline_access'
      }
    });
  var body = JSON.parse(res.getContentText());
  if (!body.access_token) throw new Error('token failed: ' + res.getContentText().slice(0, 300));
  if (body.refresh_token) SP.setProperty('REFRESH_TOKEN', body.refresh_token);
  return body.access_token;
}

function crm_(org, tok, path) {
  var out = [], url = org + '/api/data/v9.2/' + path;
  while (url) {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + tok,
        Accept: 'application/json',
        Prefer: 'odata.include-annotations="*",odata.maxpagesize=5000'
      }
    });
    if (res.getResponseCode() !== 200) throw new Error(res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
    var b = JSON.parse(res.getContentText());
    out = out.concat(b.value || []);
    url = b['@odata.nextLink'] || null;
  }
  return out;
}

var FV = function (o, f) { return o && o[f + '@OData.Community.Display.V1.FormattedValue'] || null; };
var FREQ = { 'Weekly': 4, 'Bi-Weekly': 2, 'Monthly': 1, 'Quarterly': 1 / 3 };

function refreshFromCrm() {
  var tok = token_();
  var payload = { facts: [], route: [], pipeline: [], field: [] };
  ['LV', 'NNV'].forEach(function (terr) {
    var org = terr === 'LV' ? ORG_LV : SP.getProperty('ORG_NNV');
    if (!org) return;
    pullTerritory_(org, tok, terr, payload);
  });
  payload.detail = 'facts ' + payload.facts.length;
  applySnapshot_(payload, 'dynamics');
}

function pullTerritory_(org, tok, terr, out) {
  var since = Utilities.formatDate(new Date(new Date().getFullYear(), 0, 1), 'UTC', "yyyy-MM-dd'T'00:00:00'Z'");

  // completed work orders = billed extra charges
  crm_(org, tok, "msdyn_workorders?$select=msdyn_totalamount,msdyn_completedon" +
    "&$expand=msdyn_serviceaccount($select=name,_cwm_fsm_value)" +
    "&$filter=msdyn_completedon ge " + since).forEach(function (w) {
      var p = FV(w.msdyn_serviceaccount, '_cwm_fsm_value');
      if (!p) return;
      out.facts.push({
        fact_id: 'wo:' + w.msdyn_workorderid,
        date: String(w.msdyn_completedon).slice(0, 10),
        territory: terr, person: p, type: 'workorder',
        count: 1, amount: w.msdyn_totalamount || 0, rating_customer: '', rating_fsm: ''
      });
    });

  // completed inspections
  crm_(org, tok, "cwm_inspections?$select=cwm_dateofinspection,cwm_customerratingnumerical,cwm_fsmratingnumerical" +
    "&$expand=regardingobjectid_account($select=name,_cwm_fsm_value)" +
    "&$filter=cwm_dateofinspection ge " + since).forEach(function (i) {
      var p = FV(i.regardingobjectid_account, '_cwm_fsm_value');
      if (!p) return;
      out.facts.push({
        fact_id: 'insp:' + i.activityid,
        date: String(i.cwm_dateofinspection).slice(0, 10),
        territory: terr, person: p, type: 'inspection',
        count: 1, amount: 0,
        rating_customer: i.cwm_customerratingnumerical === null ? '' : i.cwm_customerratingnumerical,
        rating_fsm: i.cwm_fsmratingnumerical === null ? '' : i.cwm_fsmratingnumerical
      });
    });

  // route from active agreements
  var route = {}, acctFsm = {};
  crm_(org, tok, "cwm_agreementheaders?$select=cwm_totalagreementprice,statecode,statuscode," +
    "_cwm_fsm_value,_cwm_accountname_value").forEach(function (a) {
      if (a.statecode !== 0 || FV(a, 'statuscode') !== 'Active Agreement') return;
      var p = FV(a, '_cwm_fsm_value');
      if (!p) return;
      route[p] = route[p] || { accounts: {}, lines: 0, monthly: 0 };
      route[p].accounts[a._cwm_accountname_value] = 1;
      route[p].lines++;
      route[p].monthly += a.cwm_totalagreementprice || 0;
      acctFsm[a._cwm_accountname_value] = p;
    });

  // expected inspections, neglected, star, from accounts under an active agreement
  var expected = {}, neglected = {}, star = {}, now = new Date();
  crm_(org, tok, "accounts?$select=cwm_inspectionfrequency,cwm_lastdateofinspection,cwm_starreason" +
    "&$filter=_cwm_fsm_value ne null and statecode eq 0").forEach(function (a) {
      var p = acctFsm[a.accountid];
      if (!p) return;
      var v = FREQ[FV(a, 'cwm_inspectionfrequency')] || 0;
      expected[p] = (expected[p] || 0) + v;
      if (v > 0) {
        var li = a.cwm_lastdateofinspection ? new Date(a.cwm_lastdateofinspection) : null;
        if (!li || (now - li) / 864e5 > 21) neglected[p] = (neglected[p] || 0) + 1;
      }
      if (a.cwm_starreason !== null && a.cwm_starreason !== undefined) star[p] = (star[p] || 0) + 1;
    });

  Object.keys(route).forEach(function (p) {
    out.route.push({
      territory: terr, person: p,
      accounts: Object.keys(route[p].accounts).length,
      agreement_lines: route[p].lines,
      monthly_value: Math.round(route[p].monthly * 100) / 100,
      expected_inspections: Math.round((expected[p] || 0) * 100) / 100
    });
  });

  // pipeline
  var pipe = {};
  var touch = function (p) { pipe[p] = pipe[p] || { quotes: 0, quote_value: 0, quotes_expired: 0, wo_lines: 0, wo_value: 0, wo_expired: 0 }; return pipe[p]; };

  crm_(org, tok, "quotes?$select=totalamount,cwm_eststartdate,cwm_jsquote,_ownerid_value" +
    "&$filter=statecode eq 0 or statecode eq 1").forEach(function (q) {
      if (q.cwm_jsquote) return;
      var p = FV(q, '_ownerid_value');
      if (!p) return;
      var o = touch(p);
      o.quotes++; o.quote_value += q.totalamount || 0;
      if (q.cwm_eststartdate && new Date(q.cwm_eststartdate) < now) o.quotes_expired++;
    });

  crm_(org, tok, "msdyn_workorderservices?$select=cwm_workorderservicedate,msdyn_totalamount,msdyn_estimatetotalamount" +
    "&$expand=msdyn_workorder($select=msdyn_completedon,statecode;$expand=msdyn_serviceaccount($select=_cwm_fsm_value))" +
    "&$filter=msdyn_workorder/msdyn_completedon eq null and msdyn_workorder/statecode eq 0").forEach(function (s) {
      var p = FV((s.msdyn_workorder || {}).msdyn_serviceaccount, '_cwm_fsm_value');
      if (!p) return;
      var o = touch(p);
      o.wo_lines++; o.wo_value += (s.msdyn_totalamount || s.msdyn_estimatetotalamount || 0);
      if (s.cwm_workorderservicedate && new Date(s.cwm_workorderservicedate) < now) o.wo_expired++;
    });

  Object.keys(pipe).forEach(function (p) {
    var o = pipe[p];
    out.pipeline.push({
      territory: terr, person: p,
      quotes: o.quotes, quote_value: Math.round(o.quote_value),
      quotes_expired: o.quotes_expired,
      wo_lines: o.wo_lines, wo_value: Math.round(o.wo_value), wo_expired: o.wo_expired
    });
  });

  // field ops
  var cases = {};
  crm_(org, tok, "incidents?$select=title&$expand=customerid_account($select=_cwm_fsm_value)&$filter=statecode eq 0")
    .forEach(function (c) {
      var p = FV(c.customerid_account, '_cwm_fsm_value');
      if (p) cases[p] = (cases[p] || 0) + 1;
    });

  var people = {};
  [route, neglected, star, cases].forEach(function (m) { Object.keys(m).forEach(function (p) { people[p] = 1; }); });
  Object.keys(people).forEach(function (p) {
    out.field.push({
      territory: terr, person: p,
      neglected_21d: neglected[p] || 0,
      open_cases: cases[p] || 0,
      star_accounts: star[p] || 0
    });
  });
}

//  ------------------------------------------------- one time authorize

// Run authorizeUrl() in the editor, open the logged URL, sign in, then copy the
// "code" query parameter off the redirect and pass it to exchangeCode('...').
function authorizeUrl() {
  var u = 'https://login.microsoftonline.com/' + SP.getProperty('TENANT_ID') + '/oauth2/v2.0/authorize' +
    '?client_id=' + encodeURIComponent(SP.getProperty('CLIENT_ID')) +
    '&response_type=code&response_mode=query' +
    '&redirect_uri=' + encodeURIComponent('https://login.microsoftonline.com/common/oauth2/nativeclient') +
    '&scope=' + encodeURIComponent(ORG_LV + '/user_impersonation offline_access');
  Logger.log(u);
  return u;
}

function exchangeCode(code) {
  var res = UrlFetchApp.fetch(
    'https://login.microsoftonline.com/' + SP.getProperty('TENANT_ID') + '/oauth2/v2.0/token',
    {
      method: 'post', muteHttpExceptions: true,
      payload: {
        client_id: SP.getProperty('CLIENT_ID'),
        client_secret: SP.getProperty('CLIENT_SECRET'),
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
        scope: ORG_LV + '/user_impersonation offline_access'
      }
    });
  var b = JSON.parse(res.getContentText());
  if (!b.refresh_token) throw new Error('no refresh token: ' + res.getContentText().slice(0, 300));
  SP.setProperty('REFRESH_TOKEN', b.refresh_token);
  return 'refresh token stored';
}

// ------------------------------------------------- one time seeding

// Seeds the Roster and Goals tabs with the Las Vegas team and the
// current goal rules. Safe to re-run, it replaces both tabs.
function seedRosterAndGoals() {
  var roster = [
    ['LV', 'Jake Schmidt', 'Field Service Manager', 'Jake Schmidt', 1, true],
    ['LV', 'Alejandro Manon', 'Field Service Manager', 'Alejandro Manon', 2, true],
    ['LV', 'Brett Stephens', 'Field Service Manager', 'Brett Stephens', 3, true],
    ['LV', 'Robert Krause', 'Director of Operations', 'Robert Krause', 4, true]
  ];
  var goals = [];
  roster.forEach(function (r) {
    goals.push([r[0], r[1], 'extra_charges', 'pct_of_route', 0.65, '2026-01-01', '65 percent of monthly route']);
    goals.push([r[0], r[1], 'inspections', 'expected', 1, '2026-01-01', '100 percent of the frequency expectation']);
  });
  writeBlock_('Roster', roster);
  writeBlock_('Goals', goals);
  return 'seeded ' + roster.length + ' roster rows and ' + goals.length + ' goal rows';
}

function writeBlock_(name, rows) {
  var sh = SS.getSheetByName(name);
  var cols = HEADERS[name].length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cols).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, cols).setValues(rows);
}
