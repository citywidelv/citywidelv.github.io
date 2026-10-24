/**
 * CW Kens Hub Backend - standalone Apps Script project for citywidelv.github.io/kens-hub/ (Oct 24 2026).
 *
 * Why its own project: the CW Team Portal Backend is at 194 of 200 deployment versions. This project has
 * its own /exec URL, its own version history, its own Sheet and Drive folder. Nothing here depends on the
 * monolith. Owner and executing account: citywidenv@cwfs-nv.com.
 *
 * Three passcodes, all script properties, none in code:
 *   KH_PASSCODE        client side (Ken's Foods staff and the porters)
 *   KH_MGR_PASSCODE    Manager Desk (the porter vendor's site manager)
 *   KH_TEAM_PASSCODE   City Wide side; set it to the same team passcode every hub uses (cw-auth.js)
 *
 * Kinds (doPost, JSON body, text/plain):
 *   kh_auth, kh_mgr_auth          passcode checks
 *   kh_submit                     save an area checklist (kha_), an end-of-shift report (khs_) or a report / message (khr_)
 *   kh_photo_put                  one JPEG for a submission
 *   kh_feed                       porter view of Ken's Foods messages (anonymised: no name, phone, email)
 *   kh_history                    the report history, scoped by role (client | manager | team): hub rows + Jotform rows
 *   kh_get                        one item in full (client: own hub items and Jotform rows; manager / team: everything)
 *   kh_photo_get                  one photo back as base64 (manager / team, plus client for report photos)
 *   kh_mgr_request                site manager supplies request (saved as a report, emails ops)
 *   kh_update                     team: status / notes on an item
 *   kh_config, kh_config_set      team: the Config tab
 *   kh_digest_now                 team: run the daily digest right now (same logic as the 5 PM trigger)
 *   kh_weekly_now                 team: run the weekly digest right now
 *
 * Storage self-provisions on first use: spreadsheet "CW Kens Hub" (tabs Checklists, Reports, Config) and Drive
 * folder "CW Kens Hub" (one JSON per submission, photos). Ids in script properties KENS_SHEET_ID / KENS_FOLDER_ID.
 * Move both into Team Portal > Client Hubs after the first run.
 *
 * Jotform history: the plant's existing forms keep running. Their Google Sheets integrations (owned by the same
 * account) are read live here and merged into the history: JF_AREA_SHEET_ID, JF_SHIFT_SHEET_ID, JF_COMM_SHEET_ID
 * (script properties; the first two are seeded below, the third is blank until that form gets a sheet).
 *
 * Digests (time triggers, khInstallTriggers once from the editor):
 *   khDigestDaily   5:00 PM Pacific every day. Everything submitted since the last daily digest. Two separate
 *                   emails: one to the client list (Config!client_to), one to the vendor list (Config!vendor_to),
 *                   City Wide (Config!cw_cc) copied on both. The vendor copy never carries Ken's contact details.
 *                   Both link to the client side of the hub.
 *   khDigestWeekly  Monday 7:00 AM Pacific. The past 7 days, to City Wide (Config!weekly_to).
 * No approval step anywhere: submissions aggregate and ride the next digest.
 */
var KH_SHEET_PROP = 'KENS_SHEET_ID', KH_FOLDER_PROP = 'KENS_FOLDER_ID';
var KH_PASS_PROP = 'KH_PASSCODE', KH_MGR_PASS_PROP = 'KH_MGR_PASSCODE', KH_TEAM_PASS_PROP = 'KH_TEAM_PASSCODE';
var KH_JF_AREA_PROP = 'JF_AREA_SHEET_ID', KH_JF_SHIFT_PROP = 'JF_SHIFT_SHEET_ID', KH_JF_COMM_PROP = 'JF_COMM_SHEET_ID';
var KH_JF_SEED = { JF_AREA_SHEET_ID: '1rtuj54Qx6BHqkjS3sKvSSyGh5oSC4iPKE1syN4Ndhus', JF_SHIFT_SHEET_ID: '1gTb76EEzDc77BbtyiUlso0InFxv5DHIQX2OgcGro19c' };
var KH_EDITOR = 'tjroberts@gocitywide.com';
var KH_TZ = 'America/Los_Angeles';
var KH_HUB = 'https://citywidelv.github.io/kens-hub/';
var KH_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var KH_LOGO_K = 'https://citywidelv.github.io/kens-hub/kens-logo.jpg';
var KH_SITE = "Ken's Foods Las Vegas";
var KH_TAB_CHECKS = 'Checklists', KH_TAB_REPORTS = 'Reports', KH_TAB_CONFIG = 'Config';

var KH_CHECK_HEADERS = ['id', 'created_at', 'service_date', 'kind', 'shift', 'area', 'round', 'porter', 'tasks_yes', 'tasks_no', 'tasks_total', 'on_schedule', 'late', 'issues', 'notes', 'photos', 'status', 'cw_notes', 'json_file', 'updated_at'];
var KH_REPORT_HEADERS = ['id', 'created_at', 'submitter', 'role', 'phone', 'email', 'mode', 'category', 'area', 'urgency', 'summary', 'status', 'cw_notes', 'photos', 'json_file', 'updated_at'];
var KH_CONFIG_HEADERS = ['key', 'value', 'what it does'];
var KH_CONFIG_SEED = [
  ['client_to', '', "Ken's Foods addresses that get the 5 PM daily digest. Comma separated. Blank = the client digest is skipped."],
  ['vendor_to', '', 'Porter vendor addresses that get the 5 PM daily digest (BLPL Cleaning). Comma separated. Blank = skipped. Never put a client address here.'],
  ['cw_cc', 'tjroberts@gocitywide.com', 'City Wide addresses copied on BOTH daily digests. Comma separated.'],
  ['weekly_to', 'tjroberts@gocitywide.com', 'City Wide addresses that get the Monday 7 AM weekly digest. Comma separated.'],
  ['report_notify', 'tjroberts@gocitywide.com', "Emailed the moment a Ken's Foods message, a porter emergency / maintenance request, or a manager supply request lands. Comma separated."],
  ['emergency_notify', '', 'Extra addresses on a porter EMERGENCY, on top of report_notify. Comma separated.'],
  ['sender_name', 'City Wide Facility Solutions', 'Display name on every email from this hub.'],
  ['reply_to', 'lvservicecall@gocitywide.com', 'Reply-to on every email from this hub. Replies come back to City Wide, never to the vendor or the client.'],
  ['site_address', '', "Ken's Foods Las Vegas plant address, shown on digests. Blank until City Wide fills it in."],
  ['last_daily_at', '', 'Set by the daily digest. The next daily digest covers everything after this instant.'],
  ['digest_live', 'FALSE', 'TRUE sends the digests to the client and vendor lists. FALSE sends every digest to cw_cc only (test mode). Default FALSE on purpose.']
];

// ------------------------------------------------------------------ router --
function doPost(e) {
  var d = {};
  try { d = JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch (err) { d = {}; }
  return khDispatch(d);
}
function doGet() { return ContentService.createTextOutput('CW Kens Hub Backend').setMimeType(ContentService.MimeType.TEXT); }
function khOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function khProp_(k) { return String(PropertiesService.getScriptProperties().getProperty(k) || ''); }
function khIsClient_(d) { var c = khProp_(KH_PASS_PROP); return !!c && String(d.passcode || '') === c; }
function khIsMgr_(d) { var m = khProp_(KH_MGR_PASS_PROP); return !!m && String(d.passcode || '') === m; }
function khIsTeam_(d) { var t = khProp_(KH_TEAM_PASS_PROP); return !!t && String(d.passcode || '') === t; }
function khRole_(d) { return khIsTeam_(d) ? 'team' : khIsMgr_(d) ? 'manager' : khIsClient_(d) ? 'client' : ''; }

function khDispatch(d) {
  var kind = String(d.kind || '');
  try {
    if (kind === 'kh_auth') {
      if (!khProp_(KH_PASS_PROP)) return khOut_({ ok: false, error: 'The Kens Hub passcode has not been set yet. Ask City Wide.' });
      return khIsClient_(d) ? khOut_({ ok: true, hub: 'kens' }) : khOut_({ ok: false, error: 'Wrong passcode' });
    }
    if (kind === 'kh_mgr_auth') {
      if (!khProp_(KH_MGR_PASS_PROP)) return khOut_({ ok: false, error: 'The Manager Desk passcode has not been set yet. Ask City Wide.' });
      return khIsMgr_(d) ? khOut_({ ok: true, hub: 'kens-manager' }) : khOut_({ ok: false, error: 'Wrong passcode' });
    }
    var role = khRole_(d);
    if (!role) return khOut_({ ok: false, error: 'Bad passcode' });
    var client = ['kh_submit', 'kh_photo_put', 'kh_feed', 'kh_history', 'kh_get', 'kh_photo_get'];
    var manager = ['kh_mgr_request'];
    var team = ['kh_update', 'kh_config', 'kh_config_set', 'kh_digest_now', 'kh_weekly_now'];
    if (manager.indexOf(kind) >= 0 && role === 'client') return khOut_({ ok: false, error: 'Bad passcode' });
    if (team.indexOf(kind) >= 0 && role !== 'team') return khOut_({ ok: false, error: 'Bad passcode' });
    if (client.indexOf(kind) < 0 && manager.indexOf(kind) < 0 && team.indexOf(kind) < 0) return khOut_({ ok: false, error: 'Unknown kh kind' });
    d._role = role;
    if (kind === 'kh_submit') return khSubmit_(d);
    if (kind === 'kh_photo_put') return khPhotoPut_(d);
    if (kind === 'kh_feed') return khFeed_(d);
    if (kind === 'kh_history') return khHistory_(d);
    if (kind === 'kh_get') return khGet_(d);
    if (kind === 'kh_photo_get') return khPhotoGet_(d);
    if (kind === 'kh_mgr_request') return khMgrRequest_(d);
    if (kind === 'kh_update') return khUpdate_(d);
    if (kind === 'kh_config') return khOut_({ ok: true, config: khConfig_(), sheet_url: khSS_().getUrl(), folder_url: khFolder_().getUrl() });
    if (kind === 'kh_config_set') { khConfigSet_(String(d.key || ''), String(d.value || '')); return khOut_({ ok: true, config: khConfig_() }); }
    if (kind === 'kh_digest_now') return khOut_(khDigestDaily({ by: khStr_(d.by, 80) }));
    if (kind === 'kh_weekly_now') return khOut_(khDigestWeekly({ by: khStr_(d.by, 80) }));
    return khOut_({ ok: false, error: 'Unknown kh kind' });
  } catch (err) {
    return khOut_({ ok: false, error: String(err && err.message || err) });
  }
}

// ----------------------------------------------------------------- storage --
function khSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(KH_SHEET_PROP) || '', ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('CW Kens Hub');
    props.setProperty(KH_SHEET_PROP, ss.getId());
    try { DriveApp.getFileById(ss.getId()).addEditor(KH_EDITOR); } catch (e2) {}
    try { DriveApp.getFileById(ss.getId()).moveTo(khFolder_()); } catch (e3) {}
  }
  return ss;
}
function khFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(KH_FOLDER_PROP) || '', folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('CW Kens Hub');
    props.setProperty(KH_FOLDER_PROP, folder.getId());
    try { folder.addEditor(KH_EDITOR); } catch (e2) {}
  }
  return folder;
}
function khSub_(name) { var root = khFolder_(); var it = root.getFoldersByName(name); return it.hasNext() ? it.next() : root.createFolder(name); }
function khTab_(name, headers, seed) {
  var ss = khSS_(), sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (first && first.getName() === 'Sheet1' && first.getLastRow() === 0) { sh = first; sh.setName(name); } else sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#08203A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    if (seed && seed.length) sh.getRange(2, 1, seed.length, headers.length).setValues(seed.map(function (r) { var o = r.slice(); while (o.length < headers.length) o.push(''); return o; }));
  }
  return sh;
}
function khChecks_() { return khTab_(KH_TAB_CHECKS, KH_CHECK_HEADERS); }
function khReports_() { return khTab_(KH_TAB_REPORTS, KH_REPORT_HEADERS); }
function khConfigTab_() { return khTab_(KH_TAB_CONFIG, KH_CONFIG_HEADERS, KH_CONFIG_SEED); }
function khConfig_() {
  var sh = khConfigTab_(), out = {}, last = sh.getLastRow();
  var v = last < 2 ? [] : sh.getRange(2, 1, last - 1, 2).getValues();
  v.forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim(); });
  KH_CONFIG_SEED.forEach(function (row) { if (!(row[0] in out)) { try { sh.appendRow(row); } catch (e) {} out[row[0]] = String(row[1] || ''); } });
  return out;
}
function khConfigSet_(key, value) {
  if (!key) return;
  var sh = khConfigTab_(), last = sh.getLastRow();
  var keys = last < 2 ? [] : sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (String(keys[i][0]).trim() === key) { sh.getRange(i + 2, 2).setValue(value); return; }
  sh.appendRow([key, value, '']);
}
function khTypeOf_(id) { id = String(id || ''); return /^kha_/.test(id) ? 'area' : /^khs_/.test(id) ? 'shift' : /^khr_/.test(id) ? 'report' : ''; }
function khSheetFor_(type) { return type === 'report' ? khReports_() : khChecks_(); }
function khHeadersFor_(type) { return type === 'report' ? KH_REPORT_HEADERS : KH_CHECK_HEADERS; }
function khFolderFor_(type) { return khSub_(type === 'report' ? 'Reports and Messages' : 'Porter Checklists'); }
function khRows_(sh, headers) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, headers.length).getValues(), rows = [];
  for (var i = 0; i < v.length; i++) {
    if (!v[i][0]) continue;
    var o = { _row: i + 2 };
    for (var c = 0; c < headers.length; c++) { var val = v[i][c]; if (val instanceof Date) val = khCell_(headers[c], val); o[headers[c]] = val; }
    rows.push(o);
  }
  return rows;
}
function khFindRow_(sh, id) {
  var last = sh.getLastRow(); if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
function khCell_(header, d) { if (header === 'service_date') return Utilities.formatDate(d, KH_TZ, 'yyyy-MM-dd'); return d.toISOString(); }
function khStr_(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n || 500); }
function khNow_() { return new Date().toISOString(); }
function khEsc_(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function khEmails_(s) { return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); }); }
function khNice_(iso) { var t = Date.parse(String(iso || '')); if (!t) return String(iso || ''); return Utilities.formatDate(new Date(t), KH_TZ, 'EEE MMM d, h:mm a'); }
function khDay_(ymd) { var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return String(ymd || ''); return Utilities.formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12), KH_TZ, 'EEEE, MMM d, yyyy'); }
function khLocalDay_(iso) { var t = Date.parse(String(iso || '')); return t ? Utilities.formatDate(new Date(t), KH_TZ, 'yyyy-MM-dd') : ''; }

// ---------------------------------------------------------------- metadata --
function khCheckMeta_(doc) {
  var tasks = doc.tasks || [], yes = 0, no = 0, late = 0, onSched = 0;
  tasks.forEach(function (t) { if (t.a === 'Yes') yes++; else if (t.a === 'No') no++; });
  (doc.stops || []).forEach(function (s) { if (s.done === 'Yes') yes++; else if (s.done === 'No') no++; if (s.done === 'Yes') { if (s.on_time === 'No') late++; else onSched++; } });
  var issues = tasks.filter(function (t) { return t.a === 'No'; }).map(function (t) { return t.q; })
    .concat((doc.stops || []).filter(function (s) { return s.done === 'No' || s.on_time === 'No'; }).map(function (s) { return s.t + ' ' + s.what + (s.done === 'No' ? ' (not done)' : ' (late)') + (s.why ? ': ' + s.why : ''); }));
  return {
    id: khStr_(doc.id, 60), created_at: khStr_(doc.created_at || khNow_(), 40), service_date: khStr_(doc.service_date, 20),
    kind: doc.kind === 'shift' ? 'shift' : 'area', shift: khStr_(doc.shift_name || doc.shift, 40), area: khStr_(doc.area_name || doc.area, 80), round: khStr_(doc.round, 40),
    porter: khStr_(doc.porter, 120), tasks_yes: yes, tasks_no: no, tasks_total: yes + no, on_schedule: onSched, late: late,
    issues: khStr_(issues.join(' | '), 1500), notes: khStr_(doc.notes, 1500), photos: (doc.photos || []).length,
    status: khStr_(doc.status || 'New', 30), cw_notes: khStr_(doc.cw_notes, 2000), updated_at: khNow_()
  };
}
function khReportMeta_(doc) {
  return {
    id: khStr_(doc.id, 60), created_at: khStr_(doc.created_at || khNow_(), 40), submitter: khStr_(doc.submitter, 120), role: khStr_(doc.role, 80),
    phone: khStr_(doc.phone, 40), email: khStr_(doc.email, 120), mode: khStr_(doc.mode, 60), category: khStr_(doc.category, 80), area: khStr_(doc.area_name || doc.area, 80),
    urgency: khStr_(doc.urgency, 40), summary: khStr_(doc.summary, 400), status: khStr_(doc.status || 'New', 30), cw_notes: khStr_(doc.cw_notes, 2000),
    photos: (doc.photos || []).length, updated_at: khNow_()
  };
}
function khUpsert_(type, doc, keepStatus) {
  var meta = type === 'report' ? khReportMeta_(doc) : khCheckMeta_(doc), headers = khHeadersFor_(type);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = khSheetFor_(type), folder = khFolderFor_(type), r = khFindRow_(sh, meta.id);
    var fileId = r ? String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue() || '') : '';
    if (r && keepStatus) meta.status = String(sh.getRange(r, headers.indexOf('status') + 1).getValue() || meta.status);
    (doc.photos || []).forEach(function (p) { delete p.data; delete p.thumb; delete p.preview; });
    var json = JSON.stringify(doc), file = null;
    if (fileId) { try { file = DriveApp.getFileById(fileId); } catch (e) { file = null; } }
    if (file) file.setContent(json); else { file = folder.createFile(meta.id + '.json', json, 'application/json'); fileId = file.getId(); }
    var row = headers.map(function (h) { if (h === 'json_file') return fileId; return meta[h] !== undefined ? meta[h] : ''; });
    if (!r) r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  } finally { lock.releaseLock(); }
  return meta;
}

// ------------------------------------------------------------------- kinds --
function khSubmit_(d) {
  var doc = d.doc;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { doc = null; } }
  if (!doc || !doc.id) return khOut_({ ok: false, error: 'Missing submission' });
  var type = khTypeOf_(doc.id);
  if (!type || !/^kh[asr]_[\w-]{1,40}$/.test(String(doc.id))) return khOut_({ ok: false, error: 'Bad id' });
  doc.created_at = doc.created_at || khNow_();
  doc.status = doc.status || 'New';
  doc.site = KH_SITE;
  if (type === 'area') doc.kind = 'area'; else if (type === 'shift') doc.kind = 'shift';
  var meta = khUpsert_(type, doc, true);
  var notified = '';
  if (type === 'report' && !d.resubmit) { try { notified = khNotifyReport_(doc); } catch (e2) { notified = ''; } }
  try { CacheService.getScriptCache().remove('kh_hub_rows'); } catch (e3) {}
  return khOut_({ ok: true, id: meta.id, type: type, notified: notified });
}
function khPhotoPut_(d) {
  var id = String(d.id || ''), pid = String(d.pid || ''), type = khTypeOf_(id);
  if (!type || !/^kh[asr]_[\w-]{1,40}$/.test(id) || !/^ph_[\w-]{1,40}$/.test(pid)) return khOut_({ ok: false, error: 'Bad ids' });
  var m = String(d.data || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!m) return khOut_({ ok: false, error: 'Photo must be a base64 JPEG' });
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 2500000) return khOut_({ ok: false, error: 'Photo too large' });
  var name = id + '_' + pid + '.jpg', folder = khFolderFor_(type);
  var ex = folder.getFilesByName(name); while (ex.hasNext()) ex.next().setTrashed(true);
  var file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  return khOut_({ ok: true, pid: pid, fileId: file.getId() });
}
function khPhotoFiles_(type, id) {
  var files = {};
  try {
    var it = khFolderFor_(type).searchFiles("title contains '" + id + "_ph_' and trashed = false");
    while (it.hasNext()) { var f = it.next(); var mm = f.getName().match(/_(ph_[\w-]+)\.jpg$/); if (mm) files[mm[1]] = f.getId(); }
  } catch (e) {}
  return files;
}
// Reports that come from City Wide's own side (porter emergency / maintenance, manager supplies) never show on
// the porter feed and never go to the client.
function khIsInternal_(r) { var mode = String(r && r.mode || ''), role = String(r && r.role || '').toLowerCase(); return /^(porter|manager)/i.test(mode) || role === 'porter' || role === 'site manager'; }
function khIsEmergency_(r) { return /emergency/i.test(String(r && r.mode || '')) || /emergency/i.test(String(r && r.urgency || '')); }

// Porter view of what Ken's Foods asked for: never who asked.
function khFeed_(d) {
  var rows = khRows_(khReports_(), KH_REPORT_HEADERS), since = Date.now() - 86400000 * (Number(d.days) || 45);
  rows = rows.filter(function (r) { if (khIsInternal_(r)) return false; var t = Date.parse(String(r.created_at || '')); return !t || t >= since; });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var out = rows.slice(0, Number(d.limit) || 120).map(function (r) { return { id: r.id, created_at: r.created_at, mode: r.mode, category: r.category, area: r.area, urgency: r.urgency, summary: r.summary, status: r.status, photos: r.photos, cw_notes: r.cw_notes }; });
  return khOut_({ ok: true, rows: out });
}

// The report history. role client sees checklists, shift reports and Ken's own messages (no porter emergencies,
// no manager supply requests, no City Wide notes). manager sees everything minus Ken's contact details. team sees all.
function khHistory_(d) {
  var role = d._role, days = Math.min(120, Number(d.days) || 14), since = Date.now() - days * 86400000;
  var items = khAllItems_(days);
  if (role === 'client') items = items.filter(function (x) { return x.type !== 'report' || !x.internal; });
  items.forEach(function (x) {
    if (role !== 'team') { delete x.cw_notes; }
    if (role !== 'team' && x.type === 'report') { delete x.phone; delete x.email; }
    if (role === 'client' && x.type === 'report') { delete x.submitter; }
  });
  return khOut_({ ok: true, role: role, days: days, items: items, today: Utilities.formatDate(new Date(), KH_TZ, 'yyyy-MM-dd') });
}
// Hub rows + Jotform rows, one flat list, newest first. Cached a few minutes because the Jotform sheets are wide.
function khAllItems_(days) {
  var since = Date.now() - days * 86400000;
  var hub = khHubItems_().filter(function (x) { var t = Date.parse(x.created_at); return !t || t >= since; });
  var jf = khJotformItems_().filter(function (x) { var t = Date.parse(x.created_at); return !t || t >= since; });
  var all = hub.concat(jf);
  all.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return all;
}
function khHubItems_() {
  var out = [];
  khRows_(khChecks_(), KH_CHECK_HEADERS).forEach(function (r) {
    out.push({ id: r.id, src: 'hub', type: r.kind === 'shift' ? 'shift' : 'area', created_at: r.created_at, day: khLocalDay_(r.created_at) || r.service_date, service_date: r.service_date,
      shift: r.shift, area: r.area, round: r.round, porter: r.porter, yes: r.tasks_yes, no: r.tasks_no, total: r.tasks_total, on_schedule: r.on_schedule, late: r.late,
      issues: r.issues, notes: r.notes, photos: r.photos, status: r.status, cw_notes: r.cw_notes });
  });
  khRows_(khReports_(), KH_REPORT_HEADERS).forEach(function (r) {
    out.push({ id: r.id, src: 'hub', type: 'report', created_at: r.created_at, day: khLocalDay_(r.created_at), internal: khIsInternal_(r), emergency: khIsEmergency_(r),
      submitter: r.submitter, role: r.role, phone: r.phone, email: r.email, mode: r.mode, category: r.category, area: r.area, urgency: r.urgency, summary: r.summary,
      photos: r.photos, status: r.status, cw_notes: r.cw_notes });
  });
  return out;
}

// ------------------------------------------------------------- Jotform history --
// The plant's three Jotforms write to Google Sheets through the Jotform integration. Those sheets are read live
// and shown in the history beside the hub's own rows, so nothing is lost when the forms are retired later.
function khJfSheet_(propKey) {
  var id = khProp_(propKey) || KH_JF_SEED[propKey] || '';
  if (!id) return null;
  try {
    var ss = SpreadsheetApp.openById(id), sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) { var sh = sheets[i]; if (sh.getLastColumn() && sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('Submission ID') >= 0) return sh; }
    return sheets[0];
  } catch (e) { return null; }
}
var khOff_ = {};
function khJfLocal_(y, mo, d, h, mi, s) {
  var guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s)), key = y + '-' + mo + '-' + d;
  if (khOff_[key] === undefined) { var z = Utilities.formatDate(guess, KH_TZ, 'Z'); var sign = z.charAt(0) === '-' ? -1 : 1; khOff_[key] = sign * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(3, 5), 10)); }
  return new Date(guess.getTime() - khOff_[key] * 60000);
}
// Jotform's Sheets integration writes the Pacific wall clock as a UTC instant. Read the wall clock back out of UTC.
function khJfDate_(v) {
  var m;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    var st = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd HH:mm:ss');
    m = st.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return v;
    return khJfLocal_(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  }
  var s = String(v || '').trim(); if (!s) return null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) return khJfLocal_(+m[1], +m[2], +m[3], m[4] ? +m[4] : 12, +(m[5] || 0), +(m[6] || 0));
  if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/))) return khJfLocal_(+m[3], +m[1], +m[2], 12, 0, 0);
  var dd = new Date(s); return isNaN(dd.getTime()) ? null : dd;
}
function khJfRead_(sh) {
  var last = sh.getLastRow(), lastC = sh.getLastColumn();
  if (last < 2 || lastC < 1) return { head: [], rows: [] };
  var head = sh.getRange(1, 1, 1, lastC).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var kc = head.indexOf('Submission ID');
  if (kc >= 0) {
    var col = sh.getRange(2, kc + 1, last - 1, 1).getValues(), lastKey = 1;
    for (var k = col.length - 1; k >= 0; k--) { if (String(col[k][0] || '').trim() !== '') { lastKey = k + 2; break; } }
    last = lastKey; if (last < 2) return { head: head, rows: [] };
  }
  return { head: head, rows: sh.getRange(2, 1, last - 1, lastC).getValues() };
}
function khJfCol_(head, re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; }
function khJfStr_(v) { if (v instanceof Date) { var d = khJfDate_(v); return d ? Utilities.formatDate(d, KH_TZ, 'yyyy-MM-dd h:mm a') : ''; } return String(v === null || v === undefined ? '' : v).trim(); }
// Jotform's shift dropdown values and the hub's shift names.
function khShiftName_(s) { s = String(s || ''); if (/^1/.test(s)) return '1st Shift'; if (/^2/.test(s)) return '2nd Shift'; if (/^3/.test(s)) return '3rd Shift'; return s; }
var KH_AREA_NAMES = { hygieneroom: 'Hygiene Room', hallways1st: 'Hallways (1st Floor)', uniformroom: 'Uniform Room', breakroom: 'Break Room (Cantina)', mensrestroom: "Men's Restroom / Locker Room", womensrestroom: "Women's Restroom / Locker Room", staircases: 'Staircases (Front & Back)', truckerlounge: 'Trucker Lounge', firstflooroffices: '1st Floor Offices (Carpet)', bathrooms1st: 'Bathrooms (1st Floor)', conferenceroom: 'Conference Room (1st Floor)', trainingrooms: 'Training Rooms (2nd Floor)', halls2nd: 'Halls (2nd Floor)', hroffices: 'HR Offices (Carpet)', elevators: 'Elevators', ptroom: 'PT Room & EHS Office', maintenanceoffices: 'Maintenance Offices', warehousemanagers: 'Warehouse Managers Offices', qalab: 'QA Lab', reception: 'Reception', culinarycenter: 'Culinary Center', warehouseoffices: 'Warehouse Offices', deepcleaning: 'Deep Cleaning' };
function khAreaName_(k) { var key = String(k || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return KH_AREA_NAMES[key] || String(k || ''); }

// Parses the three Jotform sheets into history items. Full task detail is kept per row so kh_get can show it.
function khJotformItems_() {
  var cache = null, hit = null;
  try { cache = CacheService.getScriptCache(); hit = cache.get('kh_jf_items'); } catch (e) {}
  if (hit) { try { return JSON.parse(hit); } catch (e2) {} }
  var out = [];
  // Area Cleaning Checklist (Detailed): Porter Name, Date, Shift, Area, round dropdowns, Yes/No matrices.
  var sh = khJfSheet_(KH_JF_AREA_PROP);
  if (sh) {
    var t = khJfRead_(sh), h = t.head;
    var cSub = khJfCol_(h, /^Submission Date$/i), cName = khJfCol_(h, /^Porter Name/i), cShift = khJfCol_(h, /^Shift$/i), cArea = khJfCol_(h, /^Area$/i), cId = h.indexOf('Submission ID'), cPhoto = khJfCol_(h, /^Photo/i), cNotes = khJfCol_(h, /^Anything additional/i), cDeep = khJfCol_(h, /^Deep Cleaning/i), cDate = khJfCol_(h, /^Date$/i);
    t.rows.forEach(function (v) {
      var id = String(v[cId] || '').trim(); if (!id) return;
      var sub = khJfDate_(v[cSub]); var created = sub ? sub.toISOString() : '';
      var yes = 0, no = 0, round = '', issues = [], tasks = [];
      for (var c = 0; c < h.length; c++) {
        if ([cSub, cName, cShift, cArea, cId, cPhoto, cNotes, cDeep, cDate].indexOf(c) >= 0) continue;
        var val = khJfStr_(v[c]); if (!val || !h[c]) continue;
        if (/which scheduled round/i.test(h[c])) { round = val; continue; }
        if (/Submission URL/i.test(h[c])) continue;
        var parts = h[c].split(' >> '); var q = parts.length > 1 ? parts.slice(1).join(' >> ') : h[c];
        if (/^yes$/i.test(val)) { yes++; tasks.push({ q: q, a: 'Yes' }); }
        else if (/^no$/i.test(val)) { no++; issues.push(q); tasks.push({ q: q, a: 'No' }); }
        else tasks.push({ q: q, a: val });   // the older checkbox version of the form: the value is the list of items ticked
      }
      out.push({ id: 'jfa_' + id, src: 'jotform', type: 'area', created_at: created, day: created ? Utilities.formatDate(sub, KH_TZ, 'yyyy-MM-dd') : '', service_date: (cDate >= 0 ? khJfStr_(v[cDate]).slice(0, 10) : '') || (created ? Utilities.formatDate(sub, KH_TZ, 'yyyy-MM-dd') : ''),
        shift: khShiftName_(v[cShift]), area: khAreaName_(v[cArea]), round: round, porter: khJfStr_(v[cName]), yes: yes, no: no, total: yes + no, on_schedule: '', late: '',
        issues: issues.join(' | ').slice(0, 1500), notes: [khJfStr_(cDeep >= 0 ? v[cDeep] : ''), khJfStr_(cNotes >= 0 ? v[cNotes] : '')].filter(Boolean).join(' / ').slice(0, 1500),
        photos: cPhoto >= 0 && khJfStr_(v[cPhoto]) ? 1 : 0, photo_url: cPhoto >= 0 ? khJfStr_(v[cPhoto]) : '', status: 'Jotform', tasks: tasks });
    });
  }
  // End of Shift Checklist: per stop, Task Completed / Completed on Schedule? / If not completed, explain.
  sh = khJfSheet_(KH_JF_SHIFT_PROP);
  if (sh) {
    var t2 = khJfRead_(sh), h2 = t2.head;
    var sSub = khJfCol_(h2, /^Submission Date$/i), sFirst = khJfCol_(h2, /First Name/i), sLast = khJfCol_(h2, /Last Name/i), sShift = khJfCol_(h2, /^Select your shift/i), sId = h2.indexOf('Submission ID'), sPhoto = khJfCol_(h2, /^Photo/i), sNotes = khJfCol_(h2, /^Anything additional/i);
    t2.rows.forEach(function (v) {
      var id = String(v[sId] || '').trim(); if (!id) return;
      var sub = khJfDate_(v[sSub]); var created = sub ? sub.toISOString() : '';
      var stops = {}, order = [];
      for (var c = 0; c < h2.length; c++) {
        var val = khJfStr_(v[c]); if (!val || !h2[c] || h2[c].indexOf(' >> ') < 0) continue;
        var p = h2[c].split(' >> '); if (p.length < 3) continue;
        var stop = p[1], field = p[2];
        if (!stops[stop]) { stops[stop] = { t: '', what: stop, done: '', on_time: '', why: '' }; order.push(stop); var mm = stop.match(/-\s*([\d: ]+[AP]M)\s*$/i); if (mm) { stops[stop].t = mm[1].trim(); stops[stop].what = stop.replace(/\s*-\s*[\d: ]+[AP]M\s*$/i, ''); } }
        if (/Task Completed/i.test(field)) stops[stop].done = val; else if (/on Schedule/i.test(field)) stops[stop].on_time = val; else if (/explain/i.test(field)) stops[stop].why = val;
      }
      var list = order.map(function (k) { return stops[k]; }), yes = 0, no = 0, late = 0, on = 0, issues = [];
      list.forEach(function (s) { if (/^yes/i.test(s.done)) { yes++; if (/^no/i.test(s.on_time)) { late++; issues.push(s.t + ' ' + s.what + ' (late)' + (s.why ? ': ' + s.why : '')); } else on++; } else if (/^no/i.test(s.done)) { no++; issues.push(s.t + ' ' + s.what + ' (not done)' + (s.why ? ': ' + s.why : '')); } });
      out.push({ id: 'jfs_' + id, src: 'jotform', type: 'shift', created_at: created, day: created ? Utilities.formatDate(sub, KH_TZ, 'yyyy-MM-dd') : '', service_date: '',
        shift: khShiftName_(v[sShift]), area: '', round: '', porter: [khJfStr_(v[sFirst]), khJfStr_(v[sLast])].filter(Boolean).join(' '), yes: yes, no: no, total: yes + no, on_schedule: on, late: late,
        issues: issues.join(' | ').slice(0, 1500), notes: khJfStr_(sNotes >= 0 ? v[sNotes] : '').slice(0, 1500), photos: sPhoto >= 0 && khJfStr_(v[sPhoto]) ? 1 : 0, photo_url: sPhoto >= 0 ? khJfStr_(v[sPhoto]) : '', status: 'Jotform', stops: list });
    });
  }
  // Communication & Feedback Report (only once that form has a Sheets integration; property JF_COMM_SHEET_ID).
  sh = khJfSheet_(KH_JF_COMM_PROP);
  if (sh) {
    var t3 = khJfRead_(sh), h3 = t3.head;
    var rSub = khJfCol_(h3, /^Submission Date$/i), rWho = khJfCol_(h3, /relaying/i), rArea = khJfCol_(h3, /area of the building/i), rWhat = khJfCol_(h3, /What information/i), rId = h3.indexOf('Submission ID');
    t3.rows.forEach(function (v) {
      var id = String(v[rId] || '').trim(); if (!id) return;
      var sub = khJfDate_(v[rSub]); var created = sub ? sub.toISOString() : '';
      out.push({ id: 'jfr_' + id, src: 'jotform', type: 'report', created_at: created, day: created ? Utilities.formatDate(sub, KH_TZ, 'yyyy-MM-dd') : '', internal: false, emergency: false,
        submitter: khJfStr_(v[rWho]), role: "Ken's Foods staff", mode: 'Message to City Wide', category: 'Communication', area: khJfStr_(rArea >= 0 ? v[rArea] : ''), urgency: '', summary: khJfStr_(v[rWhat]).slice(0, 400), photos: 0, status: 'Jotform' });
    });
  }
  // Cache a lean copy (no task detail) when it fits; the full list is rebuilt per call otherwise.
  try {
    var lean = JSON.stringify(out.map(function (x) { var o = {}; Object.keys(x).forEach(function (k) { if (k !== 'tasks' && k !== 'stops') o[k] = x[k]; }); return o; }));
    if (cache && lean.length < 95000) cache.put('kh_jf_items', lean, 600);
  } catch (e3) {}
  return out;
}
function khJfItem_(id) { var all = khJotformItemsFull_(); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
function khJotformItemsFull_() { try { CacheService.getScriptCache().remove('kh_jf_items'); } catch (e) {} return khJotformItems_(); }

function khGet_(d) {
  var id = String(d.id || ''), role = d._role;
  if (/^jf[asr]_/.test(id)) {
    var it = khJfItem_(id);
    if (!it) return khOut_({ ok: false, error: 'Not found' });
    if (role === 'client' && it.type === 'report' && it.internal) return khOut_({ ok: false, error: 'Not found' });
    return khOut_({ ok: true, type: it.type, src: 'jotform', doc: it, index: it, photo_files: {} });
  }
  var type = khTypeOf_(id);
  if (!type) return khOut_({ ok: false, error: 'Bad id' });
  var sh = khSheetFor_(type), headers = khHeadersFor_(type), r = khFindRow_(sh, id);
  if (!r) return khOut_({ ok: false, error: 'Not found' });
  var vals = sh.getRange(r, 1, 1, headers.length).getValues()[0], index = {};
  headers.forEach(function (h, i) { var v = vals[i]; index[h] = v instanceof Date ? khCell_(h, v) : v; });
  if (role === 'client' && type === 'report' && khIsInternal_(index)) return khOut_({ ok: false, error: 'Not found' });
  var doc = JSON.parse(DriveApp.getFileById(String(index.json_file)).getBlob().getDataAsString());
  delete index.json_file;
  if (role !== 'team') { delete doc.cw_notes; delete index.cw_notes; }
  if (role !== 'team' && type === 'report') { delete doc.phone; delete doc.email; delete index.phone; delete index.email; }
  if (role === 'client' && type === 'report') { delete doc.submitter; delete index.submitter; }
  return khOut_({ ok: true, type: type, src: 'hub', doc: doc, index: index, photo_files: khPhotoFiles_(type, id) });
}
function khPhotoGet_(d) {
  var fileId = String(d.fileId || '');
  if (!fileId) return khOut_({ ok: false, error: 'Missing fileId' });
  var file; try { file = DriveApp.getFileById(fileId); } catch (e) { return khOut_({ ok: false, error: 'Photo not found' }); }
  if (!file || file.isTrashed() || !/_ph_[\w-]+\.jpg$/.test(file.getName())) return khOut_({ ok: false, error: 'Photo not found' });
  var ok = false, ids = [khFolderFor_('report').getId(), khFolderFor_('area').getId()], parents = file.getParents();
  while (parents.hasNext()) { if (ids.indexOf(parents.next().getId()) >= 0) ok = true; }
  if (!ok) return khOut_({ ok: false, error: 'Photo not found' });
  return khOut_({ ok: true, fileId: fileId, data: 'data:image/jpeg;base64,' + Utilities.base64Encode(file.getBlob().getBytes()) });
}
function khUpdate_(d) {
  var id = String(d.id || ''), type = khTypeOf_(id);
  if (!type) return khOut_({ ok: false, error: 'Bad id' });
  var sh = khSheetFor_(type), headers = khHeadersFor_(type), r = khFindRow_(sh, id);
  if (!r) return khOut_({ ok: false, error: 'Not found' });
  var f = DriveApp.getFileById(String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue()));
  var doc = JSON.parse(f.getBlob().getDataAsString());
  if (d.status) doc.status = khStr_(d.status, 30);
  if (d.cw_notes !== undefined) doc.cw_notes = khStr_(d.cw_notes, 2000);
  doc.reviewed_by = khStr_(d.by, 120); doc.reviewed_at = khNow_();
  var meta = khUpsert_(type, doc, false);
  return khOut_({ ok: true, id: meta.id, status: meta.status });
}
function khMgrRequest_(d) {
  var kind = String(d.type || '') === 'building' ? 'building' : 'porter';
  var items = d.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
  items = (items || []).map(function (it) { return { name: khStr_(it && it.name, 120), qty: Math.max(1, Math.min(999, Number(it && it.qty) || 1)) }; }).filter(function (it) { return it.name; }).slice(0, 60);
  if (!items.length) return khOut_({ ok: false, error: 'Pick at least one item' });
  var who = khStr_(d.by, 80); if (!who) return khOut_({ ok: false, error: 'Enter your name' });
  var lines = items.map(function (it) { return it.qty + ' x ' + it.name; });
  var doc = { id: 'khr_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), created_at: khNow_(), submitter: who, role: 'Site manager', phone: khStr_(d.phone, 40), email: '',
    mode: kind === 'building' ? 'Manager building supplies request' : 'Manager porter supplies request', category: kind === 'building' ? 'Building supplies' : 'Porter supplies and chemicals',
    area: khStr_(d.where, 120), urgency: khStr_(d.urgency || 'Normal', 40), summary: (kind === 'building' ? 'Building supplies: ' : 'Porter supplies: ') + lines.join(', ').slice(0, 360),
    notes: khStr_(d.notes, 2000), answers: [{ id: 'items', q: 'Items requested', a: lines }], items: items, photos: [], status: 'New' };
  khUpsert_('report', doc, false);
  var notified = ''; try { notified = khNotifyReport_(doc); } catch (e2) { notified = ''; }
  return khOut_({ ok: true, id: doc.id, notified: notified });
}

// ------------------------------------------------------------------ email --
function khMail_(opts) {
  var cfg = khConfig_();
  opts.name = opts.name || cfg.sender_name || 'City Wide Facility Solutions';
  if (!opts.replyTo && cfg.reply_to) opts.replyTo = cfg.reply_to;
  MailApp.sendEmail(opts);
}
function khShell_(title, kicker, inner, forWhom) {
  var F = 'font-family:Verdana,Arial,sans-serif;';
  return '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;">' +
    '<tr><td style="padding:24px 30px 0;"><table border="0" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    '<td><img src="' + KH_LOGO + '" height="38" alt="City Wide Facility Solutions" style="display:block;border:0;height:38px;width:auto;"></td>' +
    '<td align="right"><img src="' + KH_LOGO_K + '" height="44" alt="Ken\'s Foods" style="display:block;border:0;height:44px;width:auto;"></td></tr></table></td></tr>' +
    '<tr><td style="padding:18px 30px 0;"><div style="background:#08203A;color:#ffffff;' + F + 'font-size:15px;font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">' + khEsc_(title) + (kicker ? ' <span style="font-weight:normal;color:#c9d2de;">&middot; ' + khEsc_(kicker) + '</span>' : '') + '</div></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' + inner +
    '<p style="margin:26px 0 0;' + F + 'font-size:11px;line-height:1.6;color:#999999;">' + khEsc_(forWhom || "Prepared for Ken's Foods by City Wide Facility Solutions.") + ' City Wide Facility Solutions | 3215 W Charleston Blvd, Suite 130, Las Vegas, NV 89102 | 702-483-1874 | GoCityWide.com</p>' +
    '</td></tr></table></td></tr></table>';
}
function khButton_(label, url) { return '<p style="margin:16px 0 0;"><a href="' + url + '" style="background:#D22730;color:#ffffff;text-decoration:none;font-weight:bold;font-family:Verdana,Arial,sans-serif;font-size:13px;padding:11px 18px;border-radius:6px;display:inline-block;">' + khEsc_(label) + '</a></p>'; }
function khFacts_(pairs) {
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var rows = pairs.filter(function (p) { return p && p[1] !== undefined && p[1] !== null && String(p[1]) !== ''; }).map(function (p) {
    return '<tr><td width="1%" style="padding:4px 14px 4px 0;' + F + 'font-size:11px;color:#636466;white-space:nowrap;vertical-align:top;">' + khEsc_(p[0]) + '</td><td style="padding:4px 0;' + F + 'font-size:13px;color:#2d2a26;line-height:1.45;">' + khEsc_(p[1]).replace(/\n/g, '<br>') + '</td></tr>';
  }).join('');
  return rows ? '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + rows + '</table>' : '';
}
// Immediate email on every report: a Ken's Foods message, a porter emergency / maintenance request, a manager supply request.
function khNotifyReport_(doc) {
  var cfg = khConfig_(), emergency = khIsEmergency_(doc), internal = khIsInternal_(doc);
  var to = khEmails_(cfg.report_notify); if (emergency) to = to.concat(khEmails_(cfg.emergency_notify));
  var seen = {}; to = to.filter(function (a) { var k = a.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  if (!to.length) return '';
  var label = emergency ? 'EMERGENCY' : /^manager/i.test(doc.mode) ? "Ken's site manager: " + (/building/i.test(doc.mode) ? 'building supplies request' : 'porter supplies request') : internal ? 'Porter maintenance request' : "Ken's Foods message";
  var subject = label + ' - ' + KH_SITE + (doc.area ? ' - ' + doc.area : '') + (doc.category && !internal ? ' - ' + doc.category : '');
  var fields = [['From', [doc.submitter, doc.role].filter(Boolean).join(', ')], ['Phone', doc.phone], ['Email', doc.email], ['Type', doc.mode], ['Category', doc.category], ['Area', doc.area], ['Urgency', doc.urgency], ['Submitted', khNice_(doc.created_at)]];
  (doc.answers || []).forEach(function (a) { if (!a || !a.q) return; var v = Array.isArray(a.a) ? a.a.join(', ') : a.a; if (v) fields.push([a.q, v]); });
  if (doc.notes) fields.push(['Anything else', doc.notes]);
  var n = (doc.photos || []).length, link = KH_HUB + 'review.html?id=' + encodeURIComponent(doc.id);
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var inner = (emergency ? '<div style="background:#FDF1F2;border:2px solid #D22730;border-radius:6px;padding:12px 14px;margin:0 0 14px;' + F + 'font-size:14px;font-weight:bold;color:#D22730;">EMERGENCY reported by the porter. Call them back now.</div>' : '') +
    (doc.summary ? '<p style="margin:0 0 12px;' + F + 'font-size:13px;color:#2d2a26;line-height:1.55;">' + khEsc_(doc.summary).replace(/\n/g, '<br>') + '</p>' : '') + khFacts_(fields) +
    (n ? '<p style="margin:10px 0 0;' + F + 'font-size:12px;color:#636466;">' + n + (n === 1 ? ' photo' : ' photos') + ' on the hub.</p>' : '') + khButton_('Open on the Kens Hub', link);
  var html = khShell_('Kens Hub', label, inner, 'Internal notice for City Wide.');
  var plain = subject + '\n\n' + (doc.summary || '') + '\n\n' + fields.filter(function (f) { return f[1]; }).map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') + '\n\n' + link;
  khMail_({ to: to.join(','), subject: subject, body: plain, htmlBody: html });
  return to.join(',');
}

// ---------------------------------------------------------------- digests --
function khInstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['khDigestDaily', 'khDigestWeekly'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('khDigestDaily').timeBased().atHour(17).everyDays(1).inTimezone(KH_TZ).create();
  ScriptApp.newTrigger('khDigestWeekly').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone(KH_TZ).create();
  Logger.log('Triggers installed: khDigestDaily 5 PM daily, khDigestWeekly Monday 7 AM (' + KH_TZ + ')');
}
// Everything submitted since the last daily digest (Config!last_daily_at; first run = the last 24 hours).
function khDigestDaily(opts) {
  opts = opts || {};
  var cfg = khConfig_(), sinceIso = cfg.last_daily_at || new Date(Date.now() - 86400000).toISOString(), now = new Date();
  var sinceT = Date.parse(sinceIso) || (Date.now() - 86400000);
  var items = khAllItems_(8).filter(function (x) { var t = Date.parse(x.created_at); return t && t > sinceT && t <= now.getTime(); });
  var span = khNice_(sinceIso) + ' to ' + khNice_(now.toISOString());
  var live = /^true$/i.test(cfg.digest_live);
  var cc = khEmails_(cfg.cw_cc), sent = [];
  // Client copy: checklists, shift reports and Ken's own messages. Never porter emergencies, manager requests or City Wide notes.
  var clientItems = items.filter(function (x) { return x.type !== 'report' || !x.internal; });
  var clientTo = live ? khEmails_(cfg.client_to) : cc, clientCc = live ? cc : [];
  if (clientTo.length) {
    var subj = 'Daily service report - ' + KH_SITE + ' - ' + Utilities.formatDate(now, KH_TZ, 'EEE MMM d') + (live ? '' : ' [TEST, digest_live is FALSE]');
    khMail_({ to: clientTo.join(','), cc: clientCc.join(','), subject: subj, body: khDigestPlain_(clientItems, span), htmlBody: khDigestHtml_('Daily service report', span, clientItems, 'client') });
    sent.push('client:' + clientTo.join(','));
  }
  // Vendor copy: the same work, with Ken's contact details stripped (the backend never stored them for Jotform rows; hub rows drop phone and email).
  var vendorItems = items.map(function (x) { var o = {}; Object.keys(x).forEach(function (k) { if (['phone', 'email', 'cw_notes'].indexOf(k) < 0) o[k] = x[k]; }); return o; });
  var vendorTo = live ? khEmails_(cfg.vendor_to) : cc, vendorCc = live ? cc : [];
  if (vendorTo.length) {
    var subjV = 'Daily porter report - ' + KH_SITE + ' - ' + Utilities.formatDate(now, KH_TZ, 'EEE MMM d') + (live ? '' : ' [TEST, digest_live is FALSE]');
    khMail_({ to: vendorTo.join(','), cc: vendorCc.join(','), subject: subjV, body: khDigestPlain_(vendorItems, span), htmlBody: khDigestHtml_('Daily porter report', span, vendorItems, 'vendor') });
    sent.push('vendor:' + vendorTo.join(','));
  }
  khConfigSet_('last_daily_at', now.toISOString());
  return { ok: true, items: items.length, since: sinceIso, sent: sent, live: live };
}
function khDigestWeekly(opts) {
  var cfg = khConfig_(), now = new Date(), items = khAllItems_(7);
  var to = khEmails_(cfg.weekly_to); if (!to.length) return { ok: false, error: 'Config!weekly_to is blank' };
  var span = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), KH_TZ, 'MMM d') + ' to ' + Utilities.formatDate(now, KH_TZ, 'MMM d, yyyy');
  khMail_({ to: to.join(','), subject: 'Weekly report - ' + KH_SITE + ' - week of ' + Utilities.formatDate(now, KH_TZ, 'MMM d'), body: khDigestPlain_(items, span), htmlBody: khDigestHtml_('Weekly report', span, items, 'team') });
  return { ok: true, items: items.length, sent: to };
}
function khGroupDays_(items) {
  var days = {}, order = [];
  items.forEach(function (x) { var d = x.day || khLocalDay_(x.created_at) || 'Undated'; if (!days[d]) { days[d] = []; order.push(d); } days[d].push(x); });
  order.sort().reverse();
  return order.map(function (d) { return { day: d, items: days[d] }; });
}
function khDigestPlain_(items, span) {
  var out = [KH_SITE + ' - ' + span, ''];
  khGroupDays_(items).forEach(function (g) {
    out.push(khDay_(g.day));
    g.items.forEach(function (x) {
      if (x.type === 'area') out.push('  ' + khNice_(x.created_at) + ' - ' + x.area + (x.round ? ' ' + x.round + ' round' : '') + ' - ' + x.porter + ' - ' + x.yes + ' of ' + x.total + ' tasks done' + (x.issues ? ' - NOT DONE: ' + x.issues : '') + (x.notes ? ' - ' + x.notes : ''));
      else if (x.type === 'shift') out.push('  ' + khNice_(x.created_at) + ' - ' + x.shift + ' end of shift - ' + x.porter + ' - ' + x.yes + ' of ' + x.total + ' stops done' + (x.late ? ', ' + x.late + ' late' : '') + (x.issues ? ' - ' + x.issues : ''));
      else out.push('  ' + khNice_(x.created_at) + ' - ' + x.mode + (x.area ? ' - ' + x.area : '') + ' - ' + (x.summary || ''));
    });
    out.push('');
  });
  out.push('Open the hub: ' + KH_HUB);
  return out.join('\n');
}
function khDigestHtml_(title, span, items, audience) {
  var F = 'font-family:Verdana,Arial,sans-serif;', e = khEsc_, cfg = khConfig_();
  var areas = items.filter(function (x) { return x.type === 'area'; }), shifts = items.filter(function (x) { return x.type === 'shift'; }), reports = items.filter(function (x) { return x.type === 'report'; });
  var yes = 0, total = 0, issues = 0; areas.concat(shifts).forEach(function (x) { yes += Number(x.yes) || 0; total += Number(x.total) || 0; if (x.no || x.late) issues++; });
  var inner = '<p style="margin:0 0 6px;' + F + 'font-size:13px;color:#2d2a26;line-height:1.55;">' + e(KH_SITE) + (cfg.site_address ? ', ' + e(cfg.site_address) : '') + '. Porter rounds and end-of-shift reports from ' + e(span) + '.</p>';
  inner += '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:10px 0 18px;"><tr>' + [['Area rounds logged', areas.length], ['End-of-shift reports', shifts.length], ['Tasks completed', yes + ' of ' + total], ['Rounds with an issue', issues]].map(function (p) {
    return '<td width="25%" style="padding:10px 8px;border:1px solid #E5E5E5;text-align:center;"><div style="' + F + 'font-size:20px;font-weight:bold;color:#08203A;">' + e(p[1]) + '</div><div style="' + F + 'font-size:10px;color:#636466;text-transform:uppercase;letter-spacing:0.05em;">' + e(p[0]) + '</div></td>';
  }).join('') + '</tr></table>';
  if (!items.length) inner += '<p style="margin:0 0 12px;' + F + 'font-size:13px;color:#636466;">Nothing was submitted in this window.</p>';
  khGroupDays_(items).forEach(function (g) {
    inner += '<h2 style="margin:18px 0 8px;' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;text-transform:uppercase;letter-spacing:0.04em;">' + e(khDay_(g.day)) + '</h2>';
    ['1st Shift', '2nd Shift', '3rd Shift', ''].forEach(function (sh) {
      var list = g.items.filter(function (x) { return (x.shift || '') === sh || (sh === '' && !x.shift); });
      if (!list.length) return;
      if (sh) inner += '<p style="margin:10px 0 4px;' + F + 'font-size:11px;font-weight:bold;color:#636466;text-transform:uppercase;letter-spacing:0.08em;">' + e(sh) + '</p>';
      list.forEach(function (x) {
        var accent = x.type === 'report' ? (x.emergency ? '#D22730' : '#08203A') : (x.no || x.late ? '#E5B423' : '#1f8a4c');
        var head, facts = [];
        if (x.type === 'area') { head = e(x.area) + (x.round ? ' <span style="font-weight:normal;color:#999999;font-size:11px;">' + e(x.round) + ' round</span>' : ''); facts = [['Porter', x.porter], ['Logged', khNice_(x.created_at)], ['Tasks', x.yes + ' of ' + x.total + ' completed'], ['Not done', x.issues], ['Notes', x.notes], ['Photos', x.photos ? x.photos : '']]; }
        else if (x.type === 'shift') { head = e(x.shift) + ' end of shift'; facts = [['Porter', x.porter], ['Logged', khNice_(x.created_at)], ['Stops', x.yes + ' of ' + x.total + ' done' + (x.late ? ', ' + x.late + ' late' : '')], ['Exceptions', x.issues], ['Notes', x.notes], ['Photos', x.photos ? x.photos : '']]; }
        else { head = e(x.mode) + (x.category && x.category !== x.mode ? ': ' + e(x.category) : ''); facts = [['Logged', khNice_(x.created_at)], ['From', audience === 'client' ? '' : [x.submitter, x.role].filter(Boolean).join(', ')], ['Area', x.area], ['Urgency', x.urgency], ['Message', x.summary], audience === 'team' ? ['City Wide notes', x.cw_notes] : null]; }
        inner += '<div style="border:1px solid #E5E5E5;border-left:4px solid ' + accent + ';border-radius:0 6px 6px 0;padding:10px 14px;margin:0 0 8px;"><p style="margin:0 0 4px;' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;">' + head + '</p>' + khFacts_(facts.filter(Boolean)) + '</div>';
      });
    });
  });
  inner += khButton_(audience === 'team' ? 'Open the City Wide review page' : 'Open the Kens Hub report history', audience === 'team' ? KH_HUB + 'review.html' : KH_HUB + 'history.html');
  if (audience === 'vendor') inner += '<p style="margin:14px 0 0;' + F + 'font-size:11px;color:#999999;">Questions go to City Wide at 702-483-1874 or by replying to this email. Please do not contact the plant directly.</p>';
  return khShell_(title, span, inner, audience === 'client' ? "Prepared for Ken's Foods by City Wide Facility Solutions." : audience === 'vendor' ? 'Prepared for the porter team by City Wide Facility Solutions.' : 'Internal weekly roll-up for City Wide.');
}

// --------------------------------------------------------------- run helpers --
function khProvisionRun() {
  khChecks_(); khReports_(); khConfigTab_();
  var props = PropertiesService.getScriptProperties();
  Object.keys(KH_JF_SEED).forEach(function (k) { if (!props.getProperty(k)) props.setProperty(k, KH_JF_SEED[k]); });
  Logger.log('CW Kens Hub book: ' + khSS_().getUrl());
  Logger.log('CW Kens Hub folder: ' + khFolder_().getUrl());
  Logger.log('Jotform rows readable: ' + khJotformItemsFull_().length);
}
function khDigestTestRun() { Logger.log(JSON.stringify(khDigestDaily({ by: 'editor test' }))); }
