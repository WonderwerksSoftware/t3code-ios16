import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3CODE_IOS_COMPATIBILITY: process.env.T3CODE_IOS_COMPATIBILITY,
    T3CODE_IOS_PERSONAL_TEAM: process.env.T3CODE_IOS_PERSONAL_TEAM,
    T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: process.env.T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID,
    T3CODE_MOBILE_UPDATES_ENABLED: process.env.T3CODE_MOBILE_UPDATES_ENABLED,
    T3CODE_RELAY_URL: process.env.T3CODE_RELAY_URL,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    EXPO_PUBLIC_CLERK_JWT_TEMPLATE: process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(
  variant: string | undefined,
  env: Record<string, string | undefined> = {},
) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  for (const key of [
    "T3CODE_IOS_COMPATIBILITY",
    "T3CODE_IOS_PERSONAL_TEAM",
    "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID",
    "T3CODE_MOBILE_UPDATES_ENABLED",
    "T3CODE_RELAY_URL",
    "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
  ]) {
    vi.stubEnv(key, env[key]);
  }
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("keeps the standard iOS deployment target unless compatibility is requested", async () => {
  const config = await loadConfig("production");
  expect(config.plugins).toContainEqual([
    "expo-build-properties",
    expect.objectContaining({ ios: expect.objectContaining({ deploymentTarget: "18.0" }) }),
  ]);
});

it("builds a bundled iOS 16 client with the Personal Team capability gates", async () => {
  const config = await loadConfig("production", {
    T3CODE_IOS_COMPATIBILITY: "1",
    T3CODE_IOS_PERSONAL_TEAM: "1",
    T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.t3code.ios16",
    T3CODE_MOBILE_UPDATES_ENABLED: "1",
    T3CODE_RELAY_URL: "https://relay.example.test",
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
    EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "t3-relay",
  });
  expect(config.plugins).toContainEqual([
    "expo-build-properties",
    expect.objectContaining({ ios: expect.objectContaining({ deploymentTarget: "16.4" }) }),
  ]);
  expect(config.updates?.enabled).toBe(false);
  expect(config.ios?.bundleIdentifier).toBe("com.example.t3code.ios16");
  expect(config.scheme).toEqual(["t3code", "com.example.t3code.ios16"]);
  expect(config.android?.package).toBe("com.t3tools.t3code");
  expect(config.extra?.iosPersonalTeamBuild).toBe(true);
  expect(config.extra?.iosCompatibility).toBe(true);
  expect(config.extra?.relay).toEqual({ url: "https://relay.example.test" });
  expect(config.extra?.clerk).toEqual({
    publishableKey: "pk_test_example",
    jwtTemplate: "t3-relay",
  });
  expect(config.plugins).not.toContainEqual(["@clerk/expo", expect.anything()]);
  expect(config.plugins).toContain("./plugins/withIosCompatibility.cjs");
  expect(config.plugins).not.toContainEqual(["expo-widgets", expect.anything()]);
  expect(config.plugins).toContainEqual([
    "expo-sharing",
    expect.objectContaining({ ios: expect.objectContaining({ enabled: false }) }),
  ]);
});
