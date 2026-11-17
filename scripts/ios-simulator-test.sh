#!/usr/bin/env bash
set -euo pipefail

mode="${1:-offline}"
case "$mode" in
  offline|live) ;;
  *) echo 'Expected offline or live.' >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
export DEVELOPER_DIR="$(bash scripts/ios-select-xcode.sh --print-path)"
build_dir="${IOS_BUILD_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pachimon-ios-validation}"
mkdir -p "$build_dir"

if [ ! -f ios/PachiMon/Resources/Web/index.html ]; then
  echo 'Bundled game is missing. Run node scripts/prepare-ios.mjs first.' >&2
  exit 1
fi

xcrun simctl list devices available --json > "$build_dir/devices.json"
simulator_id="$(python3 - "$build_dir/devices.json" <<'PY'
import json
import re
import sys
devices = json.load(open(sys.argv[1], encoding="utf-8"))["devices"]
choices = []
for runtime, entries in devices.items():
    match = re.search(r"\.iOS-([0-9]+(?:-[0-9]+)*)$", runtime)
    if not match:
        continue
    version = tuple(int(part) for part in match.group(1).split("-"))
    if version[0] < 26:
        continue
    for device in entries:
        if device.get("isAvailable") and device.get("name", "").startswith("iPhone"):
            choices.append((version, device["name"], device["udid"]))
if not choices:
    raise SystemExit("No available iOS 26+ iPhone Simulator. Check the selected Xcode runtime.")
print(sorted(choices, reverse=True)[0][2])
PY
)"
simulator_state="$(python3 - "$build_dir/devices.json" "$simulator_id" <<'PY'
import json
import sys
for group in json.load(open(sys.argv[1], encoding="utf-8"))["devices"].values():
    for device in group:
        if device["udid"] == sys.argv[2]:
            print(device["state"])
            raise SystemExit(0)
raise SystemExit("The selected simulator disappeared.")
PY
)"
if [ "$simulator_state" != Booted ]; then
  xcrun simctl boot "$simulator_id"
fi
xcrun simctl bootstatus "$simulator_id" -b

result_path="$build_dir/$mode.xcresult"
if [ -e "$result_path" ]; then
  echo "The $mode result bundle already exists. Use a fresh IOS_BUILD_DIR for a new run." >&2
  exit 1
fi

test_selector="-skip-testing:PachiMonUITests/NativeSmokeTests/testLivePeerLinkRoundTrip"
if [ "$mode" = live ]; then
  test_selector="-only-testing:PachiMonUITests/NativeSmokeTests/testLivePeerLinkRoundTrip"
fi

# No signing identity is required for an iOS Simulator build.
# A live-network error remains a failed test and is not converted to a skip.
xcodebuild \
  -project ios/PachiMon.xcodeproj \
  -scheme PachiMon \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_id" \
  -destination-timeout 120 \
  -derivedDataPath "$build_dir/DerivedData" \
  -resultBundlePath "$result_path" \
  -parallel-testing-enabled NO \
  -maximum-concurrent-test-simulator-destinations 1 \
  "$test_selector" \
  CODE_SIGNING_ALLOWED=NO \
  test 2>&1 | tee "$build_dir/$mode.log"
