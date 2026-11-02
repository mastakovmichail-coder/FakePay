; FakePay POS - установщик (Inno Setup 6).
; Собирается батником build-windows.bat, либо вручную: ISCC.exe installer\FakePay.iss

#define AppName "FakePay POS"
#define AppVersion "1.0.0"
#define AppExe "FakePay POS.exe"
#ifndef SrcDir
  #define SrcDir "..\desktop\build\FakePay POS-win32-x64"
#endif

[Setup]
AppId={{3F7A9C52-6B1E-4D84-9A2F-5E0C1B7D8A41}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=FakePay
DefaultDirName={autopf}\FakePay POS
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=FakePay-POS-Setup
SetupIconFile=..\desktop\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
CloseApplications=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "firewall"; Description: "Разрешить порт 8787 в брандмауэре (чтобы телефон в Wi-Fi сети мог подключиться к встроенному серверу)"; GroupDescription: "Сеть:"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""FakePay POS"""; Flags: runhidden; Tasks: firewall
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""FakePay POS"" dir=in action=allow protocol=TCP localport=8787"; Flags: runhidden; Tasks: firewall; StatusMsg: "Настройка брандмауэра..."
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""FakePay POS"""; Flags: runhidden; RunOnceId: "DelFirewallRule"
