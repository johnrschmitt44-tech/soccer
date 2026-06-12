/**
 * Comment endpoint for the pool site.
 * Deploy from the pool spreadsheet: Extensions > Apps Script, paste this,
 * Deploy > New deployment > Web app, Execute as: Me,
 * Who has access: Anyone. Put the /exec URL in docs/config.js COMMENTS_URL.
 */
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("bad json");
  }
  var name = String(data.name || "").trim().slice(0, 40);
  var comment = String(data.comment || "").trim().slice(0, 500);
  var key = String(data.matchKey || "").trim().slice(0, 120);
  if (!name || !comment || !key) {
    return ContentService.createTextOutput("missing fields");
  }
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName("Comments") || ss.insertSheet("Comments");
  if (sh.getLastRow() === 0) {
    sh.appendRow(["timestamp", "matchKey", "name", "comment"]);
  }
  sh.appendRow([new Date().toISOString(), key, name, comment]);
  return ContentService.createTextOutput("ok");
}
