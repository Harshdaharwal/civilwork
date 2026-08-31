/**
 * Civil Estimate WebApp -> Google Sheet bridge
 * Is code ko apni Google Sheet ke Apps Script me paste karo.
 * Sheet: https://docs.google.com/spreadsheets/d/1MhPRSmdoXu-D9dCeM5OL6_LGoPxagnszUOAARZmCZ2o/edit
 */

var SHEET_ID = '1MhPRSmdoXu-D9dCeM5OL6_LGoPxagnszUOAARZmCZ2o';

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'civil-estimate-bridge' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action !== 'sync') throw new Error('Unknown action');

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var p = data.project;

    /* ---- Projects tab ---- */
    var shP = getSheet(ss, 'Projects',
      ['Project ID', 'Project Name', 'Client', 'Location', 'Date', 'Grand Total (Rs)', 'Last Synced']);
    removeRowsById(shP, p.id);
    shP.appendRow([p.id, p.name, p.client, p.location, p.date, p.grandTotal, p.syncedAt]);

    /* ---- Measurements tab ---- */
    var shM = getSheet(ss, 'Measurements',
      ['Project ID', 'Project', 'Item of Work', 'Description', 'Unit', 'Nos', 'L', 'B', 'H', 'Qty']);
    removeRowsById(shM, p.id);
    var mRows = (data.measurements || []).map(function (m) {
      return [p.id, p.name, m.item, m.description, m.unit, m.nos, m.L, m.B, m.H, m.qty];
    });
    if (mRows.length) shM.getRange(shM.getLastRow() + 1, 1, mRows.length, 10).setValues(mRows);

    /* ---- Abstract tab ---- */
    var shA = getSheet(ss, 'Abstract',
      ['Project ID', 'Project', 'S.No', 'Item of Work', 'Qty', 'Unit', 'Rate (Rs)', 'Amount (Rs)']);
    removeRowsById(shA, p.id);
    var aRows = (data.abstract || []).map(function (r) {
      return [p.id, p.name, r.sno, r.item, r.qty, r.unit, r.rate, r.amount];
    });
    var s = data.summary || {};
    aRows.push([p.id, p.name, '', 'TOTAL CIVIL COST', '', '', '', s.civil]);
    aRows.push([p.id, p.name, '', 'Electrification', '', '', '', s.electrification]);
    aRows.push([p.id, p.name, '', 'Plumbing & Sanitary', '', '', '', s.plumbing]);
    aRows.push([p.id, p.name, '', 'Contingency', '', '', '', s.contingency]);
    aRows.push([p.id, p.name, '', 'GST', '', '', '', s.gst]);
    aRows.push([p.id, p.name, '', 'GRAND TOTAL', '', '', '', s.grandTotal]);
    if (aRows.length) shA.getRange(shA.getLastRow() + 1, 1, aRows.length, 8).setValues(aRows);

    return ContentService.createTextOutput(JSON.stringify({ ok: true, project: p.name }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* helper: tab lao ya banao, header set karo */
function getSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* helper: is project ki purani rows delete karo (re-sync par duplicate na bane) */
function removeRowsById(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(id)) sh.deleteRow(i + 2);
  }
}
