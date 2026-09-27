#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
package_root="$project_root/apps/macos"
configuration="${1:-release}"
app_root="$project_root/dist/macos/Scholia.app"
contents="$app_root/Contents"
module_cache="$package_root/.build/ScholiaModuleCache"

mkdir -p "$module_cache"
export CLANG_MODULE_CACHE_PATH="$module_cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$module_cache"
swift_arguments=(--disable-sandbox --package-path "$package_root" --configuration "$configuration")
sdk_path="${SDKROOT:-$(xcrun --sdk macosx --show-sdk-path)}"
swift_arguments+=(--sdk "$sdk_path")
sdk_interface="$(find "$sdk_path/usr/lib/swift/Swift.swiftmodule" -name '*-apple-macos.swiftinterface' -print -quit)"
if [[ -f "$sdk_interface" ]]; then
  sdk_compiler_version="$(sed -n 's|^// swift-compiler-version: ||p' "$sdk_interface" | head -n 1)"
  installed_compiler_version="$(swiftc --version | head -n 1)"
  if [[ -n "$sdk_compiler_version" && "$sdk_compiler_version" != "$installed_compiler_version" ]]; then
    swift_arguments+=(-Xswiftc -interface-compiler-version -Xswiftc "$sdk_compiler_version")
  fi
fi

swift build "${swift_arguments[@]}"
binary_dir="$(swift build "${swift_arguments[@]}" --show-bin-path)"

if [[ -e "$app_root" ]]; then
  rm -rf "$app_root"
fi
mkdir -p "$contents/MacOS" "$contents/Resources"
cp "$binary_dir/ScholiaMac" "$contents/MacOS/Scholia"
cp "$package_root/Info.plist" "$contents/Info.plist"
resource_bundles=("$binary_dir"/*.bundle(N))
for resource_bundle in "${resource_bundles[@]}"; do
  cp -R "$resource_bundle" "$contents/Resources/"
done
mkdir -p "$contents/Resources/ThirdPartyLicenses"
for dependency in swift-cmark SwiftMath; do
  dependency_root="$package_root/.build/checkouts/$dependency"
  if [[ -f "$dependency_root/LICENSE" ]]; then
    cp "$dependency_root/LICENSE" "$contents/Resources/ThirdPartyLicenses/$dependency.txt"
  elif [[ -f "$dependency_root/LICENSE.txt" ]]; then
    cp "$dependency_root/LICENSE.txt" "$contents/Resources/ThirdPartyLicenses/$dependency.txt"
  elif [[ -f "$dependency_root/COPYING" ]]; then
    cp "$dependency_root/COPYING" "$contents/Resources/ThirdPartyLicenses/$dependency.txt"
  fi
done
node "$project_root/scripts/build-study-web.mjs"
cp -R "$project_root/dist/web" "$contents/Resources/StudyWeb"
mkdir -p "$contents/Resources/Bridge/lib"
cp "$project_root/scripts/codex-bridge.mjs" "$contents/Resources/Bridge/codex-bridge.mjs"
cp "$project_root/scripts/claude-code-bridge.mjs" "$contents/Resources/Bridge/claude-code-bridge.mjs"
cp "$project_root/scripts/lib/codex-cli-arguments.mjs" "$contents/Resources/Bridge/lib/codex-cli-arguments.mjs"
cp "$project_root/scripts/lib/codex-images.mjs" "$contents/Resources/Bridge/lib/codex-images.mjs"

icon_work="$(mktemp -d "${TMPDIR:-/tmp}/scholia-icon.XXXXXX")"
trap 'rm -rf "$icon_work"' EXIT
icon_source="$icon_work/icon.svg.png"
if ! qlmanage -t -s 1024 -o "$icon_work" "$project_root/apps/chrome/assets/icon.svg" >/dev/null 2>&1; then
  icon_source="$project_root/apps/chrome/assets/icon-128.png"
fi
if [[ -f "$icon_source" ]]; then
  if ! sips -s format icns "$icon_source" --out "$contents/Resources/Scholia.icns" >/dev/null 2>&1; then
    iconset="$icon_work/Scholia.iconset"
    mkdir -p "$iconset"
    sips -z 16 16 "$icon_source" --out "$iconset/icon_16x16.png" >/dev/null
    sips -z 32 32 "$icon_source" --out "$iconset/icon_16x16@2x.png" >/dev/null
    sips -z 32 32 "$icon_source" --out "$iconset/icon_32x32.png" >/dev/null
    sips -z 64 64 "$icon_source" --out "$iconset/icon_32x32@2x.png" >/dev/null
    sips -z 128 128 "$icon_source" --out "$iconset/icon_128x128.png" >/dev/null
    sips -z 256 256 "$icon_source" --out "$iconset/icon_128x128@2x.png" >/dev/null
    sips -z 256 256 "$icon_source" --out "$iconset/icon_256x256.png" >/dev/null
    sips -z 512 512 "$icon_source" --out "$iconset/icon_256x256@2x.png" >/dev/null
    sips -z 512 512 "$icon_source" --out "$iconset/icon_512x512.png" >/dev/null
    cp "$icon_source" "$iconset/icon_512x512@2x.png"
    iconutil -c icns "$iconset" -o "$contents/Resources/Scholia.icns"
  fi
fi

signing_identity="${SCHOLIA_CODESIGN_IDENTITY:-}"
local_signing_identity="${SCHOLIA_LOCAL_CODESIGN_IDENTITY:-Scholia Local Code Signing}"
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
    | head -n 1)"
fi
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
    | head -n 1)"
fi
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | awk -v needle="\"$local_signing_identity\"" 'index($0, needle) { print substr(needle, 2, length(needle) - 2); exit }')"
fi
if [[ -z "$signing_identity" && "${SCHOLIA_AUTO_LOCAL_SIGNING:-1}" == "1" ]]; then
  "$script_dir/setup-macos-signing.sh"
  signing_identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | awk -v needle="\"$local_signing_identity\"" 'index($0, needle) { print substr(needle, 2, length(needle) - 2); exit }')"
fi
if [[ -z "$signing_identity" ]]; then
  signing_identity="-"
fi
if [[ "${SCHOLIA_REQUIRE_STABLE_SIGNING:-0}" == "1" && "$signing_identity" == "-" ]]; then
  print -u2 "A Developer ID or Apple Development signing identity is required for this build."
  exit 1
fi
codesign_arguments=(--force --deep --sign "$signing_identity")
if [[ "$signing_identity" == Developer\ ID\ Application:* ]]; then
  codesign_arguments+=(--options runtime --timestamp)
elif [[ "$signing_identity" != "-" ]]; then
  codesign_arguments+=(--options runtime)
fi
if [[ "$signing_identity" == "$local_signing_identity" ]]; then
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$contents/Info.plist")"
  certificate_sha1="$(security find-identity -v -p codesigning 2>/dev/null \
    | awk -v needle="\"$signing_identity\"" 'index($0, needle) { print $2; exit }')"
  if [[ -z "$certificate_sha1" ]]; then
    print -u2 "Could not read the local signing certificate fingerprint."
    exit 1
  fi
  codesign_arguments+=("-r=designated => identifier \"$bundle_id\" and certificate leaf = H\"$certificate_sha1\"")
fi
codesign "${codesign_arguments[@]}" "$app_root"
codesign --verify --deep --strict --verbose=2 "$app_root"
if [[ "$signing_identity" == "-" ]]; then
  print -u2 "Warning: ad-hoc signing cannot preserve macOS privacy grants across rebuilt versions."
  print -u2 "Set SCHOLIA_CODESIGN_IDENTITY or install an Apple signing identity before granting permissions."
else
  printf 'Signed with %s so macOS can retain privacy grants across updates.\n' "$signing_identity"
  codesign -d -r- "$app_root" 2>&1 | sed -n '/designated =>/p'
fi
printf 'Built %s\n' "$app_root"
