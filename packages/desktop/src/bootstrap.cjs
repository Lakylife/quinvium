// App launcher. It is small and changes only with installation: chooses a version and hands over control.
// If the new version cannot be loaded, the previous or the installed one starts, so an update does not stop the app.
const { app } = require('electron');
const path = require('node:path');
const { pickVersion, rejectVersion } = require('./versions.cjs');

// Data stays in the Aether folder even after the app was renamed: the wallet and the chain must not be lost.
app.setPath('userData', process.env.AETHER_USER_DATA ?? path.join(app.getPath('appData'), 'Aether'));

const installed = app.getVersion();
const folder = app.isPackaged ? path.join(app.getPath('userData'), 'versions') : null;
let started = false;
while (folder && !started) {
  const chosen = pickVersion(folder, installed);
  if (!chosen) break;
  try {
    app.setVersion(chosen.version);
    process.env.AETHER_RESOURCES = chosen.folder;
    require(path.join(chosen.folder, 'app.asar', 'src', 'main.cjs'));
    started = true;
  } catch (e) {
    console.error(`Verze ${chosen.version} se nedá spustit: ${e.message}`);
    rejectVersion(folder, chosen.version);
    app.setVersion(installed);
    delete process.env.AETHER_RESOURCES;
  }
}
if (!started) require('./main.cjs');
