#!/usr/bin/env bash
set -euo pipefail

# Install at scripts/build-ios16-unsigned.sh in the patched, committed source tree.
repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$repo_root"
upstream=8cf97b5f06f30a872ce30ab8a888f2ff012365a2
fail() { echo "error: $*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail "This step needs hosted macOS/Xcode; dispatch the GitHub workflow from Linux."
for tool in git vp node pod xcodebuild xcrun python3 ditto; do
  command -v "$tool" >/dev/null || fail "Missing tool: $tool"
done
git merge-base --is-ancestor "$upstream" HEAD || fail "Source must descend from pinned upstream $upstream; fetch its history."
git diff --quiet && git diff --cached --quiet || fail "Commit the compatibility patch before building, so source provenance is exact."
[[ ! -e .env && ! -e .env.local && ! -e apps/mobile/.env ]] || fail "Use a clean checkout without dotenv files; this build uses only the public configuration below."
[[ "$(node --print 'process.versions.node')" == 26.13.1 ]] || fail "Activate pinned Node 26.13.1 with Vite+."
[[ "$(node --print 'JSON.parse(require("fs").readFileSync("package.json")).packageManager')" == pnpm@12.14.0 ]] || fail "Unexpected package manager."

export APP_VARIANT=production
export T3CODE_IOS_COMPATIBILITY=1
export T3CODE_IOS_PERSONAL_TEAM=1
export T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="${T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID:-com.t3tools.t3code}"
[[ "$T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] || fail "Use a reverse-DNS bundle identifier."
# Hosted Clerk auth validates the registered native callback. Keep the production
# identity for this personal source build; the installer must refuse to replace an
# existing application. A custom identity needs its own Clerk callback registration.
export T3CODE_MOBILE_UPDATES_ENABLED=0
export MOBILE_VERSION_POLICY=appVersion
export EXPO_NO_DOTENV=1
export EXPO_NO_GIT_STATUS=1
export EXPO_NO_TYPESCRIPT_SETUP=1
export EXPO_NO_TELEMETRY=1
export CI=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
# Public production identifiers from the pinned repository's .env.example.
export T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudDMuY29kZXMk
export T3CODE_CLERK_JWT_TEMPLATE=t3-relay
export T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=hzxSgY2cH10sDU2r
export T3CODE_RELAY_URL=https://relay.t3.codes
# Keep this custom client away from maintainer-only caches and source-map upload hooks.
export T3_NATIVE_CLIENT_CACHE=off
export VP_REMOTE_CACHE=off
unset EXPO_TOKEN EAS_ACCESS_TOKEN SOURCEMAP_UPLOAD_URL
unset T3CODE_MOBILE_OTLP_TRACES_TOKEN EXPO_PUBLIC_OTLP_TRACES_TOKEN
unset T3CODE_MOBILE_OTLP_TRACES_DATASET EXPO_PUBLIC_OTLP_TRACES_DATASET
unset SKIP_BUNDLING
export FORCE_BUNDLING=1

out="${T3CODE_UNSIGNED_OUTPUT:-${RUNNER_TEMP:-/tmp}/t3-ios16-unsigned}"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
[[ ! -e "$out/T3Code-iOS16-unsigned.ipa" ]] || fail "Output IPA already exists; choose a fresh T3CODE_UNSIGNED_OUTPUT directory."
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/t3-ios16-build.XXXXXX")"
work="$(cd "$work" && pwd -P)"
export T3CODE_BUILD_WORK="$work"
export T3CODE_BUILD_OUTPUT="$out"
export T3CODE_BUILD_UPSTREAM="$upstream"
git rev-parse HEAD > "$out/source-revision.txt"
git rev-parse HEAD^{tree} > "$out/source-tree.txt"
git diff --binary "$upstream" HEAD > "$out/changes-from-upstream.patch"
{
  xcodebuild -version
  node --version
  vp --version
  pod --version
  sw_vers
} > "$out/toolchain.txt"

# Keep dependency lifecycle scripts: the vendored markdown package builds native inputs.
NODE_ENV=development vp install --frozen-lockfile --filter=@t3tools/mobile... --filter=@t3tools/scripts...
export NODE_ENV=production
cd apps/mobile
vp exec expo config --json > "$out/expo-config.json"
python3 - "$out/expo-config.json" <<'PY'
import json, os, sys
c = json.load(open(sys.argv[1]))
assert c["ios"]["bundleIdentifier"] == os.environ["T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID"]
assert c["extra"]["iosPersonalTeamBuild"] is True
assert c["updates"]["enabled"] is False, "Custom native build must not load official OTA updates"
plugins = c["plugins"]
names = [p[0] if isinstance(p, list) else p for p in plugins]
assert "expo-widgets" not in names, "Widget extension must be omitted"
sharing = next(p[1] for p in plugins if isinstance(p, list) and p[0] == "expo-sharing")
assert sharing["ios"]["enabled"] is False, "Share extension must be omitted"
properties = next(p[1] for p in plugins if isinstance(p, list) and p[0] == "expo-build-properties")
assert properties["ios"]["deploymentTarget"] == "16.4", "Apply the real iOS16 compatibility patch first"
assert c["extra"]["clerk"]["publishableKey"] == os.environ["T3CODE_CLERK_PUBLISHABLE_KEY"]
assert c["extra"]["relay"]["url"] == "https://relay.t3.codes"
PY

# --clean is limited to generated ios/ in this disposable build checkout.
vp exec expo prebuild --clean --platform ios --no-install 2>&1 | tee "$out/prebuild.log"
python3 - "$out" <<'PY'
import glob, os, plistlib, shutil, sys
out = sys.argv[1]
files = glob.glob("ios/**/*.entitlements", recursive=True)
assert files, "No generated application entitlements found"
for p in files:
    with open(p, "rb") as f:
        values = plistlib.load(f)
    for forbidden in ("aps-environment", "com.apple.developer.applesignin", "com.apple.security.application-groups"):
        assert forbidden not in values, f"{p} retains {forbidden}"
    shutil.copyfile(p, os.path.join(out, os.path.basename(p)))
PY
cd ios
pod install 2>&1 | tee "$out/pod-install.log"
cp Podfile.lock "$out/Podfile.lock"
cd ..
workspace="$(find "$PWD/ios" -maxdepth 1 -name '*.xcworkspace' -type d)"
[[ -n "$workspace" && "$workspace" != *$'\n'* ]] || fail "Expected exactly one generated Xcode workspace."
scheme="$(basename "$workspace" .xcworkspace)"
export NODE_BINARY="$(command -v node)"
printf 'export NODE_BINARY=%q\n' "$NODE_BINARY" > ios/.xcode.env.local

# Release invokes Expo's embed export and Hermes compilation in the native bundle phase.
# No provisioning updates, Developer account, certificate, or EAS service is used.
xcodebuild \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$work/DerivedData" \
  -resultBundlePath "$work/Build.xcresult" \
  -jobs 2 \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  build 2>&1 | tee "$out/xcodebuild.log"

app="$(find "$work/DerivedData/Build/Products/Release-iphoneos" -maxdepth 1 -name '*.app' -type d)"
[[ -n "$app" && "$app" != *$'\n'* ]] || fail "Expected exactly one physical-device Release application."
mkdir -p "$work/package/Payload"
ditto "$app" "$work/package/Payload/$(basename "$app")"
staged_app="$work/package/Payload/$(basename "$app")"
python3 "$repo_root/scripts/verify-ios16-app.py" "$staged_app" "$out/native-verification.json"

# The verified app is unsigned. Payload is the normal IPA container for local device signing.
(cd "$work/package" && ditto -c -k --keepParent Payload "$out/T3Code-iOS16-unsigned.ipa")
shasum -a 256 "$out/T3Code-iOS16-unsigned.ipa" > "$out/T3Code-iOS16-unsigned.ipa.sha256"
python3 - "$out" <<'PY'
import datetime, json, os, pathlib, sys
p = pathlib.Path(sys.argv[1])
record = {
  "builtAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "upstreamRevision": os.environ["T3CODE_BUILD_UPSTREAM"],
  "sourceRevision": (p / "source-revision.txt").read_text().strip(),
  "sourceTree": (p / "source-tree.txt").read_text().strip(),
  "bundleIdentifier": os.environ["T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID"],
  "configuration": "Release", "platform": "iphoneos", "architecture": "arm64",
  "minimumOS": "16.4", "signed": False, "otaUpdates": False,
  "metroRequiredAtRuntime": False,
  "physicalDeviceTested": False,
  "ipaSha256": (p / "T3Code-iOS16-unsigned.ipa.sha256").read_text().split()[0]
}
(p / "build-manifest.json").write_text(json.dumps(record, indent=2) + "\n")
PY
echo "Unsigned IPA and provenance: $out"
