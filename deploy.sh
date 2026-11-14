#!/usr/bin/env bash
# Installs Hotaru on the TV as a .wgt through apps2samsung-cli, with TV-Store open on the TV and
# "Connect from Apps2Samsung" on in its Settings.
#
#   ./deploy.sh           builds the .wgt from the working copy, as the release workflow does
#   ./deploy.sh v0.2.0    installs that release's Hotaru.wgt from GitHub
#
# TV and MAC name the TV's and this Mac's LAN addresses. An install often stalls partway and
# finishes when run again, so one not done in STALL seconds is stopped and run again, up to three times.
set -euo pipefail
cd "$(dirname "$0")"

TV=${TV:-192.168.1.20}
MAC=${MAC:-192.168.1.17}
STALL=${STALL:-180}
CLI=${CLI:-$HOME/.local/bin/apps2samsung-cli}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [[ $# -gt 0 ]]; then
  gh release download "$1" -p Hotaru.wgt -D "$work"
else
  # Stamped with the latest tag's version, so the TV takes it as no older than what's installed.
  version=$(git describe --tags --abbrev=0 2>/dev/null || echo v0.1.0)
  node check.js
  mkdir "$work/src"
  cp config.xml index.html app.js logo.png "$work/src/"
  gsed -i "s/\(<widget [^>]* version=\"\)[^\"]*/\1${version#v}/" "$work/src/config.xml"
  (cd "$work/src" && zip -q ../Hotaru.wgt config.xml index.html app.js logo.png)
  echo "Built Hotaru.wgt ${version#v} from the working copy"
fi

for try in 1 2 3; do
  if gtimeout "$STALL" "$CLI" install "$work/Hotaru.wgt" --tv "$TV" --tizen-cert public --local-ip "$MAC"; then
    exit 0
  fi
  echo "Install stopped or failed (try $try of 3); running it again" >&2
done
exit 1
