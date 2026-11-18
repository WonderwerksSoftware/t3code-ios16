module.exports = {
  dependencies:
    process.env.T3CODE_IOS_COMPATIBILITY === "1"
      ? { "@clerk/expo-native-components": { platforms: { ios: null } } }
      : {},
};
