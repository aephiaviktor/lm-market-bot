; electron-builder 26.15.3 installSection.nsh calls customInstall only after
; installApplicationFiles, registryAddInstallInfo, shortcuts and file associations.
; A normal/manual install without a handoff environment does not emit a marker.
!macro customInstall
  Push $0
  Push $1
  Push $2
  Push $3
  ReadEnvStr $0 "LM_UPDATE_HANDOFF_DIR"
  ReadEnvStr $1 "LM_UPDATE_HANDOFF_TOKEN"
  ${If} $0 != ""
  ${AndIf} $1 != ""
    System::Call 'kernel32::GetCurrentProcessId() i .r2'
    ClearErrors
    FileOpen $3 "$0\installer-complete.txt.tmp" w
    ${IfNot} ${Errors}
      FileWriteUTF16LE $3 "$1$\r$\n$2$\r$\n$INSTDIR$\r$\n${VERSION}$\r$\n"
      FileClose $3
      ${IfNot} ${Errors}
        Rename "$0\installer-complete.txt.tmp" "$0\installer-complete.txt"
      ${EndIf}
    ${EndIf}
    ; Failure to publish means the helper times out and keeps maintenance closed.
    ClearErrors
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
