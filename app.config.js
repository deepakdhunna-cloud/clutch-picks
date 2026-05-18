module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  const iosBuildNumber = process.env.EXPO_IOS_BUILD_NUMBER;
  const hasNotificationsPlugin = plugins.some((plugin) => {
    if (typeof plugin === "string") return plugin === "expo-notifications";
    return Array.isArray(plugin) && plugin[0] === "expo-notifications";
  });

  if (!hasNotificationsPlugin) {
    plugins.push([
      "expo-notifications",
      {
        defaultChannel: "default",
        enableBackgroundRemoteNotifications: false,
      },
    ]);
  }

  return {
    ...config,
    ios: {
      ...config.ios,
      ...(iosBuildNumber ? { buildNumber: iosBuildNumber } : {}),
    },
    plugins,
  };
};
