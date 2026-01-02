!macro customInstall
  ReadEnvStr $0 "ProgramData"
  StrCmp $0 "" 0 +2
    StrCpy $0 "C:\\ProgramData"
  StrCpy $1 "$0\\browser-agent\\xhs-tmp"
  CreateDirectory "$1"
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$1" /grant *S-1-5-32-545:(OI)(CI)M /T /C'
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "try { Add-MpPreference -ExclusionPath \"$1\" -ErrorAction SilentlyContinue } catch {}"'
  StrCpy $2 "$APPDATA\\browser-agent\\xhs-tmp"
  CreateDirectory "$2"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "try { Add-MpPreference -ExclusionPath \"$2\" -ErrorAction SilentlyContinue } catch {}"'
!macroend

!macro customUnInstall
  ReadEnvStr $0 "ProgramData"
  StrCmp $0 "" 0 +2
    StrCpy $0 "C:\\ProgramData"
  StrCpy $1 "$0\\browser-agent\\xhs-tmp"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "try { Remove-MpPreference -ExclusionPath \"$1\" -ErrorAction SilentlyContinue } catch {}"'
  StrCpy $2 "$APPDATA\\browser-agent\\xhs-tmp"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "try { Remove-MpPreference -ExclusionPath \"$2\" -ErrorAction SilentlyContinue } catch {}"'
!macroend
