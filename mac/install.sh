#!/bin/sh
# Build Dune Weaver Viewer (player app + Finder preview/thumbnail extensions) into
# ~/Applications and register it with Launch Services and Quick Look. Needs Xcode and xcodegen.
set -e
cd "$(dirname "$0")"

mkdir -p build
swiftc -o build/check Shared/ThrPath.swift Tests/main.swift && build/check # no -O: it strips assert

xcodegen generate --quiet
xcodebuild -project DuneWeaverViewer.xcodeproj -scheme DuneWeaverViewer -configuration Release -derivedDataPath build -quiet build

app=~/"Applications/Dune Weaver Viewer.app"
rm -rf "$app" && mkdir -p ~/Applications && cp -R "build/Build/Products/Release/Dune Weaver Viewer.app" "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
pluginkit -a "$app"/Contents/PlugIns/*.appex
qlmanage -r >/dev/null && qlmanage -r cache >/dev/null
echo "Installed $app"
