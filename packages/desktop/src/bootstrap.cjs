// Spouštěč aplikace. Je malý a mění se jen instalací: vybere verzi a předá jí řízení.
// Když se nová verze nedá načíst, spustí předchozí nebo nainstalovanou, takže aktualizace aplikaci nezastaví.
const { app } = require('electron');
const path = require('node:path');
const { pickVersion, rejectVersion } = require('./versions.cjs');

// Data zůstávají ve složce Aether i po přejmenování aplikace: peněženka a řetězec se nesmí ztratit.
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
