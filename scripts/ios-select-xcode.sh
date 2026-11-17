#!/usr/bin/env bash
set -euo pipefail

# Select only a publicly installed Xcode. No sudo, private APIs, or downloads.
python3 - "$@" <<'PY'
import os
import pathlib
import re
import subprocess
import sys

def fail(message):
    raise SystemExit("iOS build configuration error: " + message)

if sys.platform != "darwin":
    fail("Xcode requires macOS. Run the GitHub macos-15 workflow or use a Mac.")

if sys.argv[1:] not in ([], ["--print-path"]):
    fail("Expected no argument or --print-path.")

requested = os.environ.get("IOS_XCODE_VERSION", "26.2")
if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", requested):
    fail("IOS_XCODE_VERSION must contain a numeric Xcode release, such as 26.2.")

candidates = [
    pathlib.Path("/Applications") / ("Xcode_" + requested + ".app") / "Contents/Developer",
    pathlib.Path("/Applications") / ("Xcode_" + requested + ".0.app") / "Contents/Developer",
]
selected = next((p for p in candidates if p.is_dir()), None)
if selected is None:
    fail("The requested Xcode release is not installed. Check the macos-15 runner inventory and IOS_XCODE_VERSION.")

environment = dict(os.environ, DEVELOPER_DIR=str(selected))
try:
    version_text = subprocess.check_output(
        ["/usr/bin/xcodebuild", "-version"], env=environment, text=True, stderr=subprocess.STDOUT
    )
    sdk = subprocess.check_output(
        ["/usr/bin/xcrun", "--sdk", "iphoneos", "--show-sdk-version"],
        env=environment, text=True, stderr=subprocess.STDOUT
    ).strip()
except subprocess.CalledProcessError:
    fail("The selected Xcode or iPhoneOS SDK could not be loaded.")

match = re.search(r"^Xcode ([0-9]+(?:\.[0-9]+)*)", version_text, re.MULTILINE)
if not match or int(match.group(1).split(".")[0]) < 26:
    fail("App Store uploads require Xcode 26 or later.")
if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", sdk) or int(sdk.split(".")[0]) < 26:
    fail("App Store uploads require the iOS 26 SDK or later.")
if not match.group(1).startswith(requested):
    fail("The installed Xcode version does not match IOS_XCODE_VERSION.")

if os.environ.get("GITHUB_ENV"):
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
        output.write("DEVELOPER_DIR=" + str(selected) + "\n")

if sys.argv[1:] == ["--print-path"]:
    print(str(selected))
else:
    print("Using Xcode " + match.group(1) + " and iPhoneOS SDK " + sdk + ".")
    print("Minimum deployment OS and submission SDK are separate settings.")
PY
