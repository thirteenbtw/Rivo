!include "FileFunc.nsh"

; Installing a new Rivo over the old one keeps everything in place: files are
; overwritten, settings and the library live in %APPDATA%\HomeCinema anyway.
; What used to break it is a running copy. Tauri only closes Rivo.exe itself,
; which leaves rivo-server.exe (and any ffmpeg it started) holding their files,
; so the copy or the uninstall stops with "error opening file for writing".
!macro RIVO_STOP_RUNNING
  nsExec::Exec 'taskkill /F /T /IM Rivo.exe'
  nsExec::Exec 'taskkill /F /T /IM rivo-server.exe'
  ; ffmpeg is a common name, so only the copies shipped with Rivo
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process ffmpeg,ffprobe -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Sleep 1000
  !insertmacro RIVO_MOVE_ASIDE "Rivo.exe"
  !insertmacro RIVO_MOVE_ASIDE "rivo-server.exe"
  !insertmacro RIVO_MOVE_ASIDE "ffmpeg.exe"
  !insertmacro RIVO_MOVE_ASIDE "ffprobe.exe"
!macroend

; A process that will not die (stuck inside a driver call) still lets its exe
; be renamed, so move it aside and let Windows delete it on the next restart.
!macro RIVO_MOVE_ASIDE name
  Delete "$INSTDIR\${name}.old"
  Delete "$INSTDIR\${name}"
  IfFileExists "$INSTDIR\${name}" 0 +3
    Rename "$INSTDIR\${name}" "$INSTDIR\${name}.old"
    Delete /REBOOTOK "$INSTDIR\${name}.old"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro RIVO_STOP_RUNNING

  ; Rivo used to ship as "HomeCinema". Remove that install first so the two do
  ; not live side by side; the library in %APPDATA%\HomeCinema is left alone and
  ; Rivo keeps using it.
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeCinema" "UninstallString"
  StrCmp $R0 "" 0 hc_found
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeCinema" "UninstallString"
  StrCmp $R0 "" hc_done
  hc_found:
  ; carry "start with Windows" over: the autostart entry is named after the app
  ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HomeCinema"
  StrCmp $R2 "" hc_uninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HomeCinema"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Rivo" '"$INSTDIR\Rivo.exe" --minimized'
  hc_uninstall:
  nsExec::Exec 'taskkill /F /T /IM HomeCinema.exe'
  nsExec::Exec 'taskkill /F /T /IM homecinema-server.exe'
  ; the value is quoted; _?= keeps the uninstaller in place so ExecWait really waits
  StrCpy $R1 $R0 1
  StrCmp $R1 '"' 0 +2
  StrCpy $R0 $R0 -1 1
  ${GetParent} $R0 $R1
  ExecWait '"$R0" /S _?=$R1'
  Delete $R0
  RMDir $R1
  nsExec::Exec 'netsh advfirewall firewall delete rule name="HomeCinema"'
  ; and whatever Windows itself added for the old server when it asked
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$R1\homecinema-server.exe"'
  hc_done:
!macroend

; Allow the media server in Windows Firewall on private networks so TVs and
; phones on the LAN can reach it. Public networks stay closed.
; Every rule for the server goes first: if the Windows "allow access?" prompt
; was dismissed it leaves block rules for rivo-server.exe, and a block rule
; wins over our allow, so TVs would never be found.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Rivo"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\rivo-server.exe"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Rivo" dir=in action=allow program="$INSTDIR\rivo-server.exe" enable=yes profile=private'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro RIVO_STOP_RUNNING
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Rivo"'
!macroend
