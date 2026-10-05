#!/bin/zsh -l
set -uo pipefail

project_root="${0:A:h:h:h}"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

printf '\nScholia — install or update\n\n'
printf 'Building the latest changes in %s\n' "$project_root"
printf 'Scholia will reopen from Applications when the update is ready.\n\n'

if /bin/zsh "$project_root/scripts/macos/install-macos-app.sh" --launch "$@"; then
  printf '\nScholia is ready. You can close this window.\n'
else
  update_exit_code=$?
  printf '\nThe update did not finish. See the error above.\n' >&2
  if [[ -t 0 ]]; then
    read -r '?Press Return to close this window.'
  fi
  exit "$update_exit_code"
fi
