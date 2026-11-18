; Windows installer additions (electron-builder includes assets/installer.nsh by itself).
; The wallet and the chain are in the user's data folder (%APPDATA%\Aether); installing never touches them.
!include "FileFunc.nsh"

; The program folder of an earlier installation named Aether or Quintium, moved to Quinvium (see customInit).
!ifndef BUILD_UNINSTALLER
  Var quinviumOldDir
!endif

; The app was called Aether and Quintium before Quinvium. An earlier installation keeps its folder in the registry, so an
; update would go into ...\Aether again. It moves to ...\Quinvium instead; the old folder is removed after the install.
!macro customInit
  StrCpy $quinviumOldDir ""
  ${GetFileName} "$INSTDIR" $R0
  ${If} $R0 == "Aether"
  ${OrIf} $R0 == "Quintium"
  ${OrIf} $R0 == "aether-desktop"
    StrCpy $quinviumOldDir "$INSTDIR"
    ${GetParent} "$INSTDIR" $R1
    StrCpy $INSTDIR "$R1\Quinvium"
  ${ElseIf} $R0 == "AetherApp"
    ; the fallback folder of customCheckAppRunning in earlier versions
    StrCpy $quinviumOldDir "$INSTDIR"
    StrCpy $INSTDIR "$LOCALAPPDATA\Quinvium"
  ${EndIf}
!macroend

; Installing over an earlier version. The default runs the old uninstaller and stops with an error when it fails, even
; when nothing is running. Quinvium only stops the programs from its own folder (and from the old one) and overwrites the files.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; A folder without access would block the install even after a restart. A real case on Windows 10: the parent folder
    ; Programs inherited access for SYSTEM only, so every folder next to it would be just as bad. The fallback is outside it.
    ClearErrors
    CreateDirectory "$INSTDIR"
    FileOpen $R1 "$INSTDIR\quinvium-write.tmp" w
    ${if} ${Errors}
      StrCpy $INSTDIR "$LOCALAPPDATA\Quinvium"
      StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ClearErrors
      CreateDirectory "$INSTDIR"
    ${else}
      FileClose $R1
      Delete "$INSTDIR\quinvium-write.tmp"
    ${endif}
    ClearErrors
  !endif
  ; Only after the final folder is chosen: stop the programs from it, and from the old folder that is being replaced.
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $R0
  !ifndef BUILD_UNINSTALLER
    ${If} $quinviumOldDir != ""
      nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$quinviumOldDir\', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
      Pop $R0
    ${EndIf}
  !endif
  Sleep 1500
  !ifndef BUILD_UNINSTALLER
    ; Without this entry the installer does not run the old uninstaller. A new entry is written at the end of the install.
    DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
    ; A running or locked file cannot be deleted but can be renamed. Windows then removes it after a restart.
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    ${if} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$INSTDIR\${UNINSTALL_FILENAME}.old"
      Delete /REBOOTOK "$INSTDIR\${UNINSTALL_FILENAME}.old"
    ${endif}
    ; A file that still cannot be overwritten must not stop the whole install. This applies to files after this point.
    SetOverwrite try
  !endif
!macroend

; After the new version is in place: remove the old program folder, only when it holds this program (Aether.exe and
; resources\app.asar) and is not the folder just installed. Files still locked go after a restart.
!macro customInstall
  ${If} $quinviumOldDir != ""
  ${AndIf} $quinviumOldDir != "$INSTDIR"
  ${AndIf} ${FileExists} "$quinviumOldDir\Aether.exe"
  ${AndIf} ${FileExists} "$quinviumOldDir\resources\app.asar"
    RMDir /r /REBOOTOK "$quinviumOldDir"
  ${EndIf}
!macroend
