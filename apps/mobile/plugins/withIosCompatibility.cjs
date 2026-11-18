const { withPodfile } = require("expo/config-plugins");

const EXCLUDED_MODULES = "use_expo_modules!(:exclude => ['@clerk/expo-native-components'])";

module.exports = function withIosCompatibility(config) {
  return withPodfile(config, (modConfig) => {
    const podfile = modConfig.modResults.contents;
    if (podfile.includes(EXCLUDED_MODULES)) return modConfig;
    if (!/^\s*use_expo_modules!\s*$/m.test(podfile)) {
      throw new Error("Unable to exclude iOS 17 Clerk components: use_expo_modules! is missing.");
    }
    modConfig.modResults.contents = podfile.replace(
      /^(\s*)use_expo_modules!\s*$/m,
      `$1${EXCLUDED_MODULES}`,
    );
    return modConfig;
  });
};
