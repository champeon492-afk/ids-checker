#define AppName "IDS Checker"
#define AppVersion "2.0.1"

[Setup]
AppId={{A8E1A342-04CE-45BB-A3FA-A13DCE175144}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\IDS Checker
DefaultGroupName=IDS Checker
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=IDS-Checker-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\ids-logo.ico
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\app\assets\ids-logo.ico

[Files]
Source: "..\dist\windows-package\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\IDS Checker"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start-installed.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\ids-logo.ico"
Name: "{autodesktop}\IDS Checker"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start-installed.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\ids-logo.ico"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start-installed.ps1"""; Description: "Open IDS Checker"; Flags: postinstall nowait skipifsilent
