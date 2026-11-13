; Instalace přes starší verzi. Výchozí postup spouští starý odinstalátor a při jeho selhání končí chybou,
; i když ve skutečnosti nic neběží. Quinvium proto jen ukončí programy ze své složky a soubory přepíše.
; Peněženka a řetězec jsou v datech uživatele, instalace se jich netýká.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; Složka bez přístupu by instalaci zablokovala i po restartu. Skutečný případ z Windows 10: nadřazená složka Programs
    ; dědila oprávnění jen pro SYSTEM, takže stejně špatná by byla i každá jiná složka vedle ní. Náhradní je proto mimo ni.
    ClearErrors
    CreateDirectory "$INSTDIR"
    FileOpen $R1 "$INSTDIR\aether-zapis.tmp" w
    ${if} ${Errors}
      StrCpy $INSTDIR "$LOCALAPPDATA\AetherApp"
      StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ClearErrors
      CreateDirectory "$INSTDIR"
    ${else}
      FileClose $R1
      Delete "$INSTDIR\aether-zapis.tmp"
    ${endif}
    ClearErrors
  !endif
  ; Až po výběru konečné složky: ukončit se mají programy z ní, ne z té, která se použít nedá.
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $R0
  Sleep 1500
  !ifndef BUILD_UNINSTALLER
    ; Bez tohoto záznamu instalátor starý odinstalátor nespouští. Nový záznam vznikne na konci instalace.
    DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
    ; Běžící nebo zamčený soubor nejde smazat, ale jde přejmenovat. Windows ho pak odstraní po restartu.
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    ${if} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$INSTDIR\${UNINSTALL_FILENAME}.old"
      Delete /REBOOTOK "$INSTDIR\${UNINSTALL_FILENAME}.old"
    ${endif}
    ; Soubor, který ani tak nejde přepsat, nesmí zastavit celou instalaci. Týká se to souborů za tímto místem skriptu.
    SetOverwrite try
  !endif
!macroend
