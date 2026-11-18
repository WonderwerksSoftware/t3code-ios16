#!/usr/bin/env python3
"""Verify the built device app, not just its declared deployment target."""
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def version(value):
    parts = tuple(int(x) for x in value.split("."))
    return parts + (0,) * (3 - len(parts))


def inspect(app):
    with (app / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    assert info["CFBundleIdentifier"] == os.environ["T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID"]
    assert version(info["MinimumOSVersion"]) == version("16.4"), info["MinimumOSVersion"]
    assert info["CFBundleSupportedPlatforms"] == ["iPhoneOS"]
    assert (app / info["CFBundleExecutable"]).is_file()
    assert (app / "main.jsbundle").stat().st_size > 0, "Release JavaScript bundle missing"
    assert not (app / "embedded.mobileprovision").exists(), "Unexpected provisioning profile"
    assert not list(app.rglob("*.appex")), "Reduced-capability build still embeds extensions"
    signature = subprocess.run(
        ["codesign", "--display", str(app)], capture_output=True, text=True
    )
    assert signature.returncode != 0, "Application unexpectedly has a code signature"
    expo_configs = list(app.rglob("Expo.plist"))
    assert expo_configs, "Expo updates native configuration missing"
    for file in expo_configs:
        with file.open("rb") as stream:
            updates = plistlib.load(stream)
        assert updates.get("EXUpdatesEnabled") is False, "Native Expo OTA updates still enabled"

    mach_o_magics = {
        bytes.fromhex(h) for h in (
            "feedface", "cefaedfe", "feedfacf", "cffaedfe",
            "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
        )
    }
    binaries = []
    visited = set()
    for path in sorted(app.rglob("*")):
        if not path.is_file() or path.resolve() in visited:
            continue
        visited.add(path.resolve())
        with path.open("rb") as stream:
            if stream.read(4) not in mach_o_magics:
                continue
        architectures = run("xcrun", "lipo", "-archs", str(path)).strip().split()
        assert "arm64" in architectures, f"{path}: no device arm64 slice: {architectures}"
        assert not set(architectures) & {"i386", "x86_64"}, f"{path}: simulator slices found"
        commands = run("xcrun", "otool", "-l", str(path))
        minima = []
        for block in commands.split("Load command"):
            if "cmd LC_BUILD_VERSION" in block:
                platform = re.search(r"\bplatform\s+(\S+)", block)
                minimum = re.search(r"\bminos\s+([0-9.]+)", block)
                assert platform and platform[1] in {"2", "IOS"}, f"{path}: not an iOS device binary"
                assert minimum, f"{path}: missing native minimum OS"
                minima.append(minimum[1])
            elif "cmd LC_VERSION_MIN_IPHONEOS" in block:
                minima.append(re.search(r"\bversion\s+([0-9.]+)", block)[1])
        assert minima, f"{path}: no iOS minimum OS load command"
        assert all(version(v) <= version("16.4") for v in minima), (
            f"{path}: requires {minima}; do not lower metadata to hide a native dependency floor"
        )
        binaries.append({
            "path": str(path.relative_to(app)),
            "architectures": architectures,
            "minimumOSVersions": minima,
        })
    assert binaries, "No native executable verified"
    return {
        "application": app.name,
        "bundleIdentifier": info["CFBundleIdentifier"],
        "minimumOSVersion": info["MinimumOSVersion"],
        "embeddedJavaScriptBytes": (app / "main.jsbundle").stat().st_size,
        "unsignedApplication": True,
        "otaUpdates": False,
        "nativeBinaries": binaries,
        "physicalDeviceTested": False,
    }


if __name__ == "__main__":
    result = inspect(Path(sys.argv[1]).resolve())
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")
    print(f"Verified {len(result['nativeBinaries'])} native binaries and bundled Release JavaScript.")
