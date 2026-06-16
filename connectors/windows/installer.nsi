Unicode True
ManifestDPIAware True

!define PRODUCT_NAME "Opus Connector"
!define PRODUCT_VERSION "0.3.4"
!define PUBLISHER "Opus Command"
!define APP_EXE "OpusConnector.exe"
!define SOURCE_DIR "..\..\dist\OpusConnector-win32-x64"
!define DATA_DIR "C:\ProgramData\OpusConnector"
!define INSTALL_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpusConnector"
!define RUN_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${PRODUCT_NAME}"
OutFile "..\..\dist\OpusConnector-Setup-${PRODUCT_VERSION}.exe"
InstallDir "C:\OpusConnector"
InstallDirRegKey HKLM "${INSTALL_REG_KEY}" "InstallLocation"
RequestExecutionLevel admin

!define MUI_ICON "assets\app-icon.ico"
!define MUI_UNICON "assets\app-icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"

!include "MUI2.nsh"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext all

  ; Stop any running instance so a silent auto-update can replace locked files.
  ; Kill by image name only (no /T): during an auto-update the app launches this
  ; installer as a child process, so /T would walk the app's process tree and
  ; terminate the installer itself mid-run — crashing the update. /F /IM already
  ; kills every OpusConnector.exe process (Electron's helper processes share the
  ; image name on Windows), which is all we need to unlock the install dir.
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXE}"'
  Sleep 1500

  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}\*.*"

  CreateDirectory "${DATA_DIR}"
  CreateDirectory "${DATA_DIR}\config"
  CreateDirectory "${DATA_DIR}\logs"
  CreateDirectory "${DATA_DIR}\OpusCommand"
  nsExec::ExecToLog 'icacls "${DATA_DIR}" /grant *S-1-5-32-545:(OI)(CI)M /T /C'

  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${INSTALL_REG_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${INSTALL_REG_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${INSTALL_REG_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${INSTALL_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${INSTALL_REG_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKLM "${INSTALL_REG_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "${INSTALL_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${INSTALL_REG_KEY}" "NoRepair" 1

  ; Start the connector automatically at logon, elevated (as administrator), so
  ; it stays paired and online with the privileges its jobs need. A scheduled
  ; task with the highest run level (/RL HIGHEST) launches the app with admin
  ; rights and no UAC prompt on every login — something the plain Run key can't
  ; do. Remove any legacy Run-key autostart so we don't also launch an
  ; unelevated copy.
  DeleteRegValue HKLM "${RUN_REG_KEY}" "OpusConnector"
  nsExec::ExecToLog 'schtasks /Create /TN "OpusConnector" /TR "\"$INSTDIR\${APP_EXE}\"" /SC ONLOGON /RL HIGHEST /F'

  ; A silent run (auto-update) skips the finish page, so relaunch the app here.
  ; Launch via the scheduled task so the relaunch is elevated too, matching the
  ; logon start.
  IfSilent 0 +2
    nsExec::ExecToLog 'schtasks /Run /TN "OpusConnector"'
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::ExecToLog 'taskkill /F /T /IM "${APP_EXE}"'
  Sleep 1000
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  nsExec::ExecToLog 'schtasks /Delete /TN "OpusConnector" /F'
  DeleteRegValue HKLM "${RUN_REG_KEY}" "OpusConnector"
  DeleteRegKey HKLM "${INSTALL_REG_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
