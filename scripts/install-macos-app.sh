#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
source_app="$project_root/dist/macos/Scholia.app"
destination_app="${SCHOLIA_INSTALL_PATH:-/Applications/Scholia.app}"
migrate_permissions=0
launch_after_install=0
skip_build=0
check_only=0

for argument in "$@"; do
  case "$argument" in
    --migrate-permissions) migrate_permissions=1 ;;
    --launch) launch_after_install=1 ;;
    --skip-build) skip_build=1 ;;
    --check-only) check_only=1 ;;
    *) print -u2 "Unknown option: $argument"; exit 2 ;;
  esac
done

if [[ "$skip_build" != "1" ]]; then
  "$script_dir/build-macos-app.sh"
fi

if [[ ! -d "$source_app" ]]; then
  print -u2 "The built app is missing: $source_app"
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$source_app"
signature="$(codesign -dv --verbose=4 "$source_app" 2>&1)"
if [[ "$signature" == *"Signature=adhoc"* ]]; then
  print -u2 "Refusing to install an ad-hoc-signed build because it would lose macOS privacy grants."
  print -u2 "Run npm run setup:macos-signing, then build again."
  exit 1
fi

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist")"
identity_changed=0
if [[ -d "$destination_app" ]]; then
  old_requirement="$(codesign -d -r- "$destination_app" 2>&1 \
    | sed -n 's/^# designated => //p; s/^designated => //p' \
    | head -n 1)"
  if [[ -z "$old_requirement" ]] \
      || ! codesign --verify --deep --strict -R="$old_requirement" "$source_app" >/dev/null 2>&1; then
    identity_changed=1
  fi
fi

if [[ "$check_only" == "1" ]]; then
  if [[ "$identity_changed" == "1" ]]; then
    printf 'A one-time signing migration is required before future updates can preserve permissions.\n'
  else
    printf 'Update identity is compatible; Accessibility and Screen Recording grants will be preserved.\n'
  fi
  exit 0
fi

if pgrep -f "$destination_app/Contents/MacOS/Scholia" >/dev/null 2>&1; then
  osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
  for _ in {1..50}; do
    pgrep -f "$destination_app/Contents/MacOS/Scholia" >/dev/null 2>&1 || break
    sleep 0.1
  done
  if pgrep -f "$destination_app/Contents/MacOS/Scholia" >/dev/null 2>&1; then
    print -u2 "Scholia is still running. Quit it and run the installer again."
    exit 1
  fi
fi

destination_parent="${destination_app:h}"
mkdir -p "$destination_parent"
stage_dir="$(mktemp -d "$destination_parent/.scholia-update.XXXXXX")"
cleanup_install() {
  if [[ -d "$stage_dir/Previous-Scholia.app" ]]; then
    print -u2 "The update did not finish. The previous app is preserved at $stage_dir/Previous-Scholia.app"
  else
    rm -rf "$stage_dir"
  fi
}
trap cleanup_install EXIT
staged_app="$stage_dir/Scholia.app"
ditto "$source_app" "$staged_app"
codesign --verify --deep --strict --verbose=2 "$staged_app"

backup_app=""
if [[ -d "$destination_app" ]]; then
  backup_app="$stage_dir/Previous-Scholia.app"
  mv "$destination_app" "$backup_app"
fi

if ! mv "$staged_app" "$destination_app"; then
  if [[ -n "$backup_app" && -d "$backup_app" && ! -e "$destination_app" ]]; then
    mv "$backup_app" "$destination_app"
  fi
  print -u2 "Installation failed; the previous app was restored."
  exit 1
fi
if ! codesign --verify --deep --strict --verbose=2 "$destination_app"; then
  mv "$destination_app" "$staged_app"
  if [[ -n "$backup_app" && -d "$backup_app" ]]; then
    mv "$backup_app" "$destination_app"
  fi
  print -u2 "Installed app verification failed; the update was rolled back."
  exit 1
fi
if [[ -n "$backup_app" ]]; then
  rm -rf "$backup_app"
fi

if [[ "$identity_changed" == "1" ]]; then
  if [[ "$migrate_permissions" == "1" ]]; then
    tccutil reset Accessibility "$bundle_id" >/dev/null
    tccutil reset ScreenCapture "$bundle_id" >/dev/null
    printf 'Cleared stale Accessibility and Screen Recording entries for the one-time signing migration.\n'
  else
    print -u2 "Signing identity changed. Existing privacy grants cannot carry into this one-time migration."
    print -u2 "Run this installer once with --migrate-permissions, then grant access to the new stable identity."
  fi
else
  printf 'The new build satisfies the installed app requirement; privacy grants are preserved.\n'
fi

printf 'Installed %s\n' "$destination_app"

if [[ "$launch_after_install" == "1" ]]; then
  open "$destination_app"
fi
