; Remove Sentry's Explorer integration when it is uninstalled (it's per-user, so HKCU).
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\SentryUpload"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SentryUpload"
  Delete "$APPDATA\Microsoft\Windows\SendTo\Google Drive (Sentry).lnk"
!macroend
