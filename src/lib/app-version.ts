import Constants from 'expo-constants';

export function getAppVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '1.1.1';
  const iosBuild = Constants.expoConfig?.ios?.buildNumber;
  const androidBuild = Constants.expoConfig?.android?.versionCode;
  const build = iosBuild ?? (androidBuild === undefined ? undefined : String(androidBuild));

  return build ? `Clutch Picks v${version} (${build})` : `Clutch Picks v${version}`;
}
