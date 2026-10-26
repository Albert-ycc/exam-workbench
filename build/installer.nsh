; 组卷工作台安装程序的自定义段（electron-builder 自动包含 build/installer.nsh）。
; 更新时怎么关掉正在运行的程序：electron-builder 默认先弹「正在运行，点确定关闭」，再结束进程，结束不了就让用户「手动关闭」——
; 程序留在后台没有窗口时用户无从下手。这里改成：先请程序自己保存并退出（带 --quit 再启动一份，走单实例通道），
; 等不到再强制结束整棵进程树，仍在才提示用户去任务管理器。安装与卸载都走这一段。

; 0 = 程序还在运行
!macro EWB_FIND_APP _RESULT
  ${If} $ewbPowerShell == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "if ((Get-CimInstance Win32_Process | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' }).Count -gt 0) { exit 0 } else { exit 1 }"`
  ${Else}
    nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  ${EndIf}
  Pop ${_RESULT}
!macroend

!macro customCheckAppRunning
  Var /GLOBAL ewbPowerShell
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`
  Pop $ewbPowerShell

  !insertmacro EWB_FIND_APP $R0
  ${If} $R0 == 0
    ; 1. 请程序自己保存并退出，最多等 8 秒
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "正在请「${PRODUCT_NAME}」保存并退出…"
      nsExec::Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit`
      Pop $R2
      StrCpy $R1 0
      ${Do}
        Sleep 500
        IntOp $R1 $R1 + 1
        !insertmacro EWB_FIND_APP $R0
        ${If} $R0 != 0
          ${ExitDo}
        ${EndIf}
        ${If} $R1 >= 16
          ${ExitDo}
        ${EndIf}
      ${Loop}
    ${EndIf}

    ; 2. 没退出就强制结束（连同子进程）
    ${If} $R0 == 0
      DetailPrint "「${PRODUCT_NAME}」没有响应，正在强制结束…"
      ${If} $ewbPowerShell == 0
        nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance Win32_Process | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' } | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
        Pop $R2
      ${EndIf}
      nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
      Pop $R2
      Sleep 1500
      !insertmacro EWB_FIND_APP $R0
    ${EndIf}

    ; 3. 仍在运行：说清原因与办法，让用户处理后重试
    ${Do}
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "「${PRODUCT_NAME}」仍在运行，安装程序结束不了它（多半是它以管理员身份运行，或被安全软件拦住了）。$\r$\n$\r$\n请按 Ctrl+Shift+Esc 打开任务管理器，结束所有「${PRODUCT_NAME}」进程，再点「重试」。" /SD IDCANCEL IDRETRY +2
      Quit
      !insertmacro EWB_FIND_APP $R0
    ${Loop}
  ${EndIf}
!macroend
