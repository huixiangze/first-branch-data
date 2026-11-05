' ---------------------------------------------------------------
' DP Data Sync Agent - silent launcher (double-click this)
' Runs bin\sync-runner.bat with no console window.
' The runner keeps the agent alive and restarts it if it exits.
' ---------------------------------------------------------------
Option Explicit
Dim fso, sh, root, runner

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
runner = root & "\bin\sync-runner.bat"

If Not fso.FileExists(runner) Then
  MsgBox "bin\sync-runner.bat not found." & vbCrLf & "Re-check the project folder.", 16, "DP Data Sync Agent"
  WScript.Quit 1
End If

sh.CurrentDirectory = root
sh.Run "cmd /c """ & runner & """", 0, False
