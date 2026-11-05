' ---------------------------------------------------------------
' DP Data Sync Agent - hidden launcher
' Runs bin\sync-runner.bat with no console window, then exits.
' Path is derived from this script, so the project folder may be moved.
' ---------------------------------------------------------------
Option Explicit
Dim fso, sh, here, root, runner

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)
runner = here & "\sync-runner.bat"

If Not fso.FileExists(runner) Then
  WScript.Quit 1
End If

sh.CurrentDirectory = root
sh.Run "cmd /c """ & runner & """", 0, False
