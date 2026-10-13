/**
 * Google Apps Script: copies recruiter emails to a Drive folder as .eml files.
 *
 * Runs inside your own Google account, so the app never holds Gmail
 * credentials. It only reads mail and writes files; it does not label, move
 * or delete messages. Pair it with Google Drive for desktop so the folder
 * syncs to the computer running Locum Radar, then run `npm run import-mail`.
 *
 * Setup: script.google.com → New project → paste this file → set FOLDER_NAME
 * and QUERY → run `install` once and approve the Gmail/Drive read-and-create
 * permissions it asks for. Remove the trigger from the Triggers page to stop.
 */
const FOLDER_NAME = 'Locum Radar mail drop';
// Senders seen in your inbox; widen as new agencies appear.
const QUERY =
  '(from:medrecruit.com OR from:1medical.com.au OR subject:locum) newer_than:14d -in:sent -in:chats';

function install() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'exportLocumMail')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('exportLocumMail').timeBased().everyHours(2).create();
  exportLocumMail();
}

function exportLocumMail() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  const threads = GmailApp.search(QUERY, 0, 100);
  let written = 0;
  threads.forEach((thread) =>
    thread.getMessages().forEach((message) => {
      const name = `${message.getDate().toISOString().slice(0, 10)}-${message.getId()}.eml`;
      if (folder.getFilesByName(name).hasNext()) return;
      folder.createFile(Utilities.newBlob(message.getRawContent(), 'message/rfc822', name));
      written++;
    }),
  );
  console.log(`${written} new message(s) exported to "${FOLDER_NAME}".`);
}
