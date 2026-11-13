// Po sestavení pro Windows: Aether.exe dostane vlastní ikonu a údaje. Bez toho ho systém ukazuje jako Electron.
// Soubor se upravuje přímo v Node.js, takže sestavení z macOS nepotřebuje Wine.
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

const ENGLISH = 1033;
const UNICODE = 1200;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productName, buildVersion } = context.packager.appInfo;
  const version = context.packager.appInfo.version ?? buildVersion;
  const file = `${context.packager.platformSpecificBuildOptions.executableName ?? productName}.exe`;     // spouštěč si drží původní název kvůli aktualizacím
  const exePath = path.join(context.appOutDir, file);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, icon.icons.map((i) => i.data));

  const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = version.split('.').map(Number);
  info.setFileVersion(a, b, c, 0, ENGLISH);
  info.setProductVersion(a, b, c, 0, ENGLISH);
  info.setStringValues({ lang: ENGLISH, codepage: UNICODE }, {
    CompanyName: productName, FileDescription: productName, InternalName: productName, LegalCopyright: productName,
    OriginalFilename: file, ProductName: productName, ProductVersion: version, FileVersion: version,
  });
  info.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • ${file}: ikona a údaje ${version}`);
};
