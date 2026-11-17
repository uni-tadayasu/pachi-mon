#!/usr/bin/env bash
# Manual Apple Distribution signing. No automatic certificate creation.
set +x
set -euo pipefail

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"
  fi
}
fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

missing=()
for required_name in \
  APPLE_TEAM_ID \
  IOS_DISTRIBUTION_P12_BASE64 \
  IOS_DISTRIBUTION_P12_PASSWORD \
  IOS_PROVISIONING_PROFILE_BASE64 \
  ASC_KEY_ID \
  ASC_ISSUER_ID \
  ASC_PRIVATE_KEY_BASE64
do
  if [ -z "${!required_name:-}" ]; then
    missing+=("$required_name")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo 'ready=false' >> "$GITHUB_OUTPUT"
  fi
  summary '## App Store Connect: 未送信' \
    'Appleの署名・アップロード設定が不足しています。未署名アプリを送信したり、審査へ提出したりしていません。' \
    '' '不足している設定名:'
  for required_name in "${missing[@]}"; do
    printf 'Missing configuration: %s\n' "$required_name"
    summary "- ${required_name}"
  done
  summary '' 'APPLE_TEAM_IDはRepository variable、それ以外はRepository secretsです。docs/APP_STORE_JA.mdを参照してください。'
  if [ "${1:-}" = --check-config ] && [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]; then
    exit 0
  fi
  exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo 'ready=true' >> "$GITHUB_OUTPUT"
fi
if [ "${1:-}" = --check-config ]; then
  summary '## Apple設定' \
    '必要な設定名は揃っています。値の有効性、証明書、Profile、Apple側権限は署名ジョブで検証します。まだアップロードは実施していません。'
  exit 0
fi
if [ "$#" -gt 0 ]; then
  fail 'Expected no argument, or --check-config.'
fi
if [ "${GITHUB_ACTIONS:-}" = true ] && [ "${GITHUB_REF:-}" != refs/heads/main ]; then
  fail 'App Store upload is restricted to the main branch.'
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
export IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-com.kasaisolutions.pachimon}"
export IOS_MARKETING_VERSION="${IOS_MARKETING_VERSION:-1.0.0}"

# The currently deployed service must support real account deletion.
# This is a public, read-only request; no player identity or secret is sent.
if ! node --input-type=module <<'JS'
const endpoint = 'https://pachi-mon-admin-hub.hisa-0128-1996.chatgpt.site/api/status';
try {
  const response = await fetch(endpoint, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true || data.accountDeletionSupported !== true) {
    throw new Error('Account deletion has not been deployed.');
  }
  console.log('Production account-deletion capability is advertised.');
} catch {
  console.error('本番APIでaccountDeletionSupported:trueを確認できません。');
  process.exitCode = 1;
}
JS
then
  summary '## App Store Connect: 未送信' \
    'アカウント削除サーバー更新が未反映、または本番APIに接続できないため、アップロード未実施です。' \
    '本番の通信サービスを更新し、GET /api/status の accountDeletionSupported が true になってから再実行してください。'
  exit 1
fi

export DEVELOPER_DIR="$(bash scripts/ios-select-xcode.sh --print-path)"
build_dir="${IOS_BUILD_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pachimon-ios-distribution}"
mkdir -p "$build_dir"
build_dir="$(cd "$build_dir" && pwd)"
if [ -e "$build_dir/PachiMon.xcarchive" ] || [ -e "$build_dir/export" ]; then
  fail 'Distribution output already exists. Use a fresh IOS_BUILD_DIR.'
fi
if [ ! -f ios/PachiMon/Resources/Web/index.html ]; then
  fail 'Bundled resources are missing. Run node scripts/prepare-ios.mjs first.'
fi

signing_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pachimon-signing.XXXXXX")"
chmod 700 "$signing_dir"
keychain_path="$signing_dir/signing.keychain-db"
keychain_password="$(openssl rand -hex 32)"
uploaded=false
upload_attempted=false
keychain_created=false
profile_targets=()
profile_backups=()

cleanup() {
  result=$?
  trap - EXIT INT TERM
  set +e
  set +u
  for ((i=0; i<${#profile_targets[@]}; i++)); do
    if [ -f "${profile_backups[$i]}" ]; then
      cp "${profile_backups[$i]}" "${profile_targets[$i]}"
    else
      rm -f "${profile_targets[$i]}"
    fi
  done
  if [ -f "$signing_dir/keychains.json" ]; then
    python3 - "$signing_dir/keychains.json" <<'PY'
import json
import subprocess
import sys
paths = json.load(open(sys.argv[1], encoding="utf-8"))
subprocess.run(["security", "list-keychains", "-d", "user", "-s", *paths], check=False)
PY
  fi
  if [ "$keychain_created" = true ]; then
    security delete-keychain "$keychain_path" >/dev/null 2>&1
  fi
  rm -rf "$signing_dir"
  if [ "$result" -ne 0 ]; then
    if [ "$upload_attempted" = true ]; then
      summary '## アップロード失敗または結果未確定' \
        'アップロード処理が正常終了しませんでした。App Store Connectで実際のビルド有無を確認してください。成功とは扱っていません。' \
        '一時秘密鍵・証明書・Keychain・インストールしたProfileは後処理で削除または元へ戻します。'
    else
      summary '## App Store Connect: 未送信' \
        '署名・ビルド・検証でエラーが発生したため、アップロードしていません。失敗したステップを確認してください。' \
        '一時秘密鍵・証明書・Keychain・インストールしたProfileは後処理で削除または元へ戻します。'
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 - "$signing_dir" <<'PY'
import base64
import os
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
def fail(message):
    raise SystemExit("Apple signing setup error: " + message)

if not re.fullmatch(r"[A-Z0-9]{10}", os.environ["APPLE_TEAM_ID"]):
    fail("APPLE_TEAM_ID must be the 10-character Apple team identifier.")
if not re.fullmatch(r"[A-Z0-9]{10}", os.environ["ASC_KEY_ID"]):
    fail("ASC_KEY_ID must be the 10-character Team API key identifier.")
if not re.fullmatch(r"[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}", os.environ["ASC_ISSUER_ID"]):
    fail("ASC_ISSUER_ID must be the Team API issuer UUID.")
if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+", os.environ["IOS_BUNDLE_ID"]):
    fail("IOS_BUNDLE_ID must be an explicit reverse-domain bundle identifier.")
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", os.environ["IOS_MARKETING_VERSION"]):
    fail("IOS_MARKETING_VERSION must contain three numeric components, such as 1.0.0.")

explicit = os.environ.get("IOS_BUILD_NUMBER", "")
if explicit:
    build = explicit
else:
    run_text, attempt_text = os.environ.get("GITHUB_RUN_NUMBER", ""), os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if not run_text.isdecimal() or not attempt_text.isdecimal():
        fail("For a local upload set IOS_BUILD_NUMBER. In Actions, run number and attempt must be present.")
    run, attempt = int(run_text), int(attempt_text)
    if run < 1 or not 1 <= attempt <= 99:
        fail("Invalid run number or more than 99 attempts. Do not reuse an existing build number.")
    build = f"{1 + (run - 1) // 100}.{(run - 1) % 100}.{attempt}"
if not re.fullmatch(r"[1-9][0-9]{0,3}\.(?:0|[1-9][0-9]?)\.(?:0|[1-9][0-9]?)", build):
    fail("Build number must fit Apple's conservative 4-digit.2-digit.2-digit numeric limits.")
(root / "build-number.txt").write_text(build, encoding="utf-8")

outputs = [
    ("IOS_DISTRIBUTION_P12_BASE64", root / "distribution.p12"),
    ("IOS_PROVISIONING_PROFILE_BASE64", root / "app.mobileprovision"),
    ("ASC_PRIVATE_KEY_BASE64", root / "private_keys" / ("AuthKey_" + os.environ["ASC_KEY_ID"] + ".p8")),
]
for name, target in outputs:
    try:
        data = base64.b64decode("".join(os.environ[name].split()), validate=True)
    except Exception:
        fail(name + " is not valid base64.")
    if not data:
        fail(name + " decodes to an empty file.")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target.write_bytes(data)
    target.chmod(0o600)
PY

unset IOS_DISTRIBUTION_P12_BASE64 IOS_PROVISIONING_PROFILE_BASE64 ASC_PRIVATE_KEY_BASE64
build_number="$(cat "$signing_dir/build-number.txt")"
api_key_file="$signing_dir/private_keys/AuthKey_${ASC_KEY_ID}.p8"
if ! openssl pkey -in "$api_key_file" -noout >/dev/null 2>&1; then
  fail 'ASC_PRIVATE_KEY_BASE64 is not a readable unencrypted API private key.'
fi
security cms -D -i "$signing_dir/app.mobileprovision" > "$signing_dir/profile.plist"

security list-keychains -d user | python3 -c 'import json,shlex,sys; json.dump(shlex.split(sys.stdin.read()),sys.stdout)' > "$signing_dir/keychains.json"
security create-keychain -p "$keychain_password" "$keychain_path" >/dev/null
keychain_created=true
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$signing_dir/distribution.p12" \
  -k "$keychain_path" \
  -P "$IOS_DISTRIBUTION_P12_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null
unset IOS_DISTRIBUTION_P12_PASSWORD
security set-key-partition-list -S apple-tool:,apple:,codesign: -k "$keychain_password" "$keychain_path" >/dev/null

python3 - "$signing_dir/keychains.json" "$keychain_path" <<'PY'
import json
import subprocess
import sys
paths = json.load(open(sys.argv[1], encoding="utf-8"))
subprocess.run(["security", "list-keychains", "-d", "user", "-s", sys.argv[2], *paths], check=True)
PY
security find-identity -v -p codesigning "$keychain_path" > "$signing_dir/identities.txt"

python3 - "$signing_dir" <<'PY'
import datetime
import hashlib
import os
import pathlib
import plistlib
import re
import sys

root = pathlib.Path(sys.argv[1])
profile = plistlib.loads((root / "profile.plist").read_bytes())
def fail(message):
    raise SystemExit("Provisioning profile error: " + message)

team, bundle = os.environ["APPLE_TEAM_ID"], os.environ["IOS_BUNDLE_ID"]
if team not in profile.get("TeamIdentifier", []):
    fail("The profile does not belong to APPLE_TEAM_ID.")
entitlements = profile.get("Entitlements", {})
prefixes = profile.get("ApplicationIdentifierPrefix", [])
if entitlements.get("application-identifier") not in [prefix + "." + bundle for prefix in prefixes]:
    fail("The profile must use the exact IOS_BUNDLE_ID. Wildcard profiles are not accepted.")
if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices") or entitlements.get("get-task-allow"):
    fail("Use an App Store Connect distribution profile, not development, Ad Hoc, or enterprise.")
if "iOS" not in profile.get("Platform", []):
    fail("The profile must support iOS.")
expiration = profile.get("ExpirationDate")
if not isinstance(expiration, datetime.datetime):
    fail("The profile does not contain an expiration date.")
if expiration.tzinfo is None:
    expiration = expiration.replace(tzinfo=datetime.timezone.utc)
if expiration <= datetime.datetime.now(datetime.timezone.utc):
    fail("The profile has expired.")
uuid = profile.get("UUID", "")
if not re.fullmatch(r"[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}", uuid):
    fail("The profile UUID is invalid.")

allowed = {hashlib.sha1(data).hexdigest().upper() for data in profile.get("DeveloperCertificates", [])}
identities = re.findall(r'\b([A-Fa-f0-9]{40})\b[^\n]*"([^"]+)"', (root / "identities.txt").read_text())
matches = [digest.upper() for digest, name in identities
           if digest.upper() in allowed and name.startswith(("Apple Distribution:", "iPhone Distribution:"))]
if not matches:
    fail("No valid distribution identity with a private key matches the profile. Export the matching certificate and its private key as P12.")
identity = matches[0]
(root / "profile-uuid.txt").write_text(uuid, encoding="utf-8")
(root / "identity.txt").write_text(identity, encoding="utf-8")
options = {
    "method": "app-store-connect",
    "destination": "export",
    "signingStyle": "manual",
    "teamID": team,
    "signingCertificate": identity,
    "provisioningProfiles": {bundle: uuid},
    "manageAppVersionAndBuildNumber": False,
    "stripSwiftSymbols": True,
    "uploadSymbols": True,
}
(root / "ExportOptions.plist").write_bytes(plistlib.dumps(options))
PY

profile_uuid="$(cat "$signing_dir/profile-uuid.txt")"
signing_identity="$(cat "$signing_dir/identity.txt")"
# Xcode uses the newer location; retain compatibility with the legacy location.
# Exact preexisting profile files are restored during cleanup.
for profile_dir in \
  "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" \
  "$HOME/Library/MobileDevice/Provisioning Profiles"
do
  mkdir -p "$profile_dir"
  target="$profile_dir/$profile_uuid.mobileprovision"
  backup="$signing_dir/profile-backup-${#profile_targets[@]}.mobileprovision"
  if [ -f "$target" ]; then
    cp "$target" "$backup"
  fi
  profile_targets+=("$target")
  profile_backups+=("$backup")
  cp "$signing_dir/app.mobileprovision" "$target"
done

xcodebuild -quiet \
  -project ios/PachiMon.xcodeproj \
  -scheme PachiMon \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$build_dir/PachiMon.xcarchive" \
  -derivedDataPath "$build_dir/DerivedData" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  PACHI_BUNDLE_IDENTIFIER="$IOS_BUNDLE_ID" \
  PRODUCT_BUNDLE_IDENTIFIER="$IOS_BUNDLE_ID" \
  MARKETING_VERSION="$IOS_MARKETING_VERSION" \
  CURRENT_PROJECT_VERSION="$build_number" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$signing_identity" \
  PROVISIONING_PROFILE_SPECIFIER="$profile_uuid" \
  CODE_SIGNING_ALLOWED=YES \
  archive

codesign --verify --deep --strict "$build_dir/PachiMon.xcarchive/Products/Applications/PachiMon.app"

xcodebuild -quiet \
  -exportArchive \
  -archivePath "$build_dir/PachiMon.xcarchive" \
  -exportPath "$build_dir/export" \
  -exportOptionsPlist "$signing_dir/ExportOptions.plist"

ipa="$(python3 - "$build_dir/export" <<'PY'
import pathlib
import sys
files = list(pathlib.Path(sys.argv[1]).glob("*.ipa"))
if len(files) != 1:
    raise SystemExit("Expected exactly one signed IPA.")
print(files[0].resolve())
PY
)"

xcrun altool --help > "$signing_dir/altool-help.txt" 2>&1 || true
if ! python3 - "$signing_dir/altool-help.txt" <<'PY'
import pathlib
import sys
text = pathlib.Path(sys.argv[1]).read_text(errors="replace")
if any(flag not in text for flag in ("--upload-app", "--validate-app", "--apiKey", "--apiIssuer")):
    raise SystemExit(1)
PY
then
  fail 'The selected Xcode does not provide the required altool App Store/API-key upload options.'
fi

auth_arguments=(--apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID")
# Newer altool supports an explicit key path. Older versions search ./private_keys.
if python3 - "$signing_dir/altool-help.txt" <<'PY'
import pathlib
import sys
raise SystemExit(0 if "--p8-file-path" in pathlib.Path(sys.argv[1]).read_text(errors="replace") else 1)
PY
then
  auth_arguments+=(--p8-file-path "$api_key_file")
fi

(
  cd "$signing_dir"
  xcrun altool --validate-app --type ios --file "$ipa" "${auth_arguments[@]}"
)
upload_attempted=true
(
  cd "$signing_dir"
  xcrun altool --upload-app --type ios --file "$ipa" "${auth_arguments[@]}"
)
uploaded=true

summary '## App Store Connect: アップロードコマンド正常終了' \
  "Bundle ID: ${IOS_BUNDLE_ID}" \
  "Version: ${IOS_MARKETING_VERSION}; build: ${build_number}" \
  '' \
  'Apple側の処理完了・TestFlightでの利用可否はApp Store Connectで確認してください。' \
  'この処理は審査提出・審査承認・一般公開を行いません。暗号輸出申告も自動回答していません。' \
  '一時秘密鍵・P12・Keychain・インストールしたProfileは終了時に削除または元へ戻します。'
printf 'Upload command completed for version %s, build %s. Check processing in App Store Connect.\n' "$IOS_MARKETING_VERSION" "$build_number"
