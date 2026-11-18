import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { compileModsAsync } from "expo/config-plugins";
import { afterEach, expect, it } from "vite-plus/test";

import withIosCompatibility from "./withIosCompatibility.cjs";

const projectRoots: string[] = [];

afterEach(() => {
  for (const root of projectRoots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

async function prebuildPodfile(podfile: string) {
  const projectRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ios16-compatibility-"));
  projectRoots.push(projectRoot);
  NodeFS.mkdirSync(NodePath.join(projectRoot, "ios"));
  const podfilePath = NodePath.join(projectRoot, "ios/Podfile");
  NodeFS.writeFileSync(podfilePath, podfile);
  await compileModsAsync(withIosCompatibility({ name: "T3 Code", slug: "t3code" }), {
    projectRoot,
    platforms: ["ios"],
  });
  return NodeFS.readFileSync(podfilePath, "utf8");
}

it("excludes the iOS 17 Clerk UI from Expo autolinking and preserves the Podfile on repeat", async () => {
  const once = await prebuildPodfile("target 'T3Code' do\n  use_expo_modules!\nend\n");
  expect(once).toContain("use_expo_modules!(:exclude => ['@clerk/expo-native-components'])");
  expect(await prebuildPodfile(once)).toBe(once);
});

it("fails before CocoaPods when the Expo Podfile entry point changed", async () => {
  await expect(prebuildPodfile("target 'T3Code' do\nend\n")).rejects.toThrow(
    "Unable to exclude iOS 17 Clerk components: use_expo_modules! is missing.",
  );
});
