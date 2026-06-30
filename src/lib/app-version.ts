import Constants from 'expo-constants';

// OTA revision tag — bump this string on every OTA update so the Settings
// build badge visibly changes the instant a new update is downloaded and
// applied on device. This is independent of the native build number (which
// only changes on a full store/TestFlight build), so it is the reliable
// signal that an over-the-air JS update actually reached the device.
export const OTA_REVISION = 'r8';

export function getAppVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '1.1.1';
  const iosBuild = Constants.expoConfig?.ios?.buildNumber;
  const androidBuild = Constants.expoConfig?.android?.versionCode;
  const build = iosBuild ?? (androidBuild === undefined ? undefined : String(androidBuild));

  const base = build ? `Clutch Picks v${version} (${build})` : `Clutch Picks v${version}`;
  return `${base} · ${OTA_REVISION}`;
}
