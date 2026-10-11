; Per-user installer (no admin): the app, the Explorer thumbnail provider and web/.
;   iscc /DVersion=1.0.0 installer.iss   (after the CMake Release build in build/)
#ifndef Version
  #define Version "0.0.0"
#endif
#define Name "Dune Weaver Viewer"
#define Exe "DuneWeaverViewer.exe"
; Thumbnail.cpp's CLSID_Thumbnail, and Windows' IThumbnailProvider handler key.
#define Thumbnailer "{{CE7AFF1B-5CD9-4088-B83E-0690F024F041}"
#define ThumbnailKey "{{E357FCCD-A995-4576-B01F-234630154E96}"

[Setup]
AppId={{C7CF883E-6DBF-41DC-B2F7-5E03C52AF441}
AppName={#Name}
AppVersion={#Version}
AppPublisher=Dune Weaver Inc.
AppPublisherURL=https://duneweaver.com
AppSupportURL=https://github.com/tuanchris/dune-weaver-viewer
DefaultDirName={autopf}\{#Name}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
WizardStyle=modern
SetupIconFile=app\icon.ico
UninstallDisplayIcon={app}\{#Exe}
OutputDir=build
OutputBaseFilename=DuneWeaverViewer-{#Version}-windows-x64

[Files]
Source: "build\Release\{#Exe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\Release\DuneWeaverThumbnail.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{autoprograms}\{#Name}"; Filename: "{app}\{#Exe}"

[Registry]
Root: HKCU; Subkey: "Software\Classes\.thr"; ValueType: string; ValueData: "DuneWeaver.Pattern"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.thr\OpenWithProgids"; ValueType: string; ValueName: "DuneWeaver.Pattern"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.thr\ShellEx\{#ThumbnailKey}"; ValueType: string; ValueData: "{#Thumbnailer}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\DuneWeaver.Pattern"; ValueType: string; ValueData: "Dune Weaver pattern"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\DuneWeaver.Pattern\DefaultIcon"; ValueType: string; ValueData: "{app}\{#Exe},0"
Root: HKCU; Subkey: "Software\Classes\DuneWeaver.Pattern\shell\open\command"; ValueType: string; ValueData: """{app}\{#Exe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\CLSID\{#Thumbnailer}"; ValueType: string; ValueData: "{#Name} thumbnails"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\CLSID\{#Thumbnailer}\InprocServer32"; ValueType: string; ValueData: "{app}\DuneWeaverThumbnail.dll"
Root: HKCU; Subkey: "Software\Classes\CLSID\{#Thumbnailer}\InprocServer32"; ValueType: string; ValueName: "ThreadingModel"; ValueData: "Apartment"
