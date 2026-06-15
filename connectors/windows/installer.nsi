Unicode True
ManifestDPIAware True

!define PRODUCT_NAME "Opus Connector"
!define PRODUCT_VERSION "0.2.0"
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

!define MUI_ICON "assets\mark-dark.ico"
!define MUI_UNICON "assets\mark-dark.ico"
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
  nsExec::ExecToLog 'taskkill /F /T /IM "${APP_EXE}"'
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

  ; Start the connector automatically at login so it stays paired and online.
  WriteRegStr HKLM "${RUN_REG_KEY}" "OpusConnector" '"$INSTDIR\${APP_EXE}"'

  ; A silent run (auto-update) skips the finish page, so relaunch the app here.
  IfSilent 0 +2
    Exec '"$INSTDIR\${APP_EXE}"'
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::ExecToLog 'taskkill /F /T /IM "${APP_EXE}"'
  Sleep 1000
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegValue HKLM "${RUN_REG_KEY}" "OpusConnector"
  DeleteRegKey HKLM "${INSTALL_REG_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
