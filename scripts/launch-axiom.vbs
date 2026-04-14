' AXIOM silent launcher
Dim shell
Set shell = CreateObject("WScript.Shell")
Dim exePath
exePath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\axiom\AXIOM.exe"
shell.Run Chr(34) & exePath & Chr(34), 0, False
