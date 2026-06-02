import * as ImagePicker from "expo-image-picker";
import {
  pickedFileFromAsset,
  type PickedFile,
  type PickFileOutcome,
} from "./file-picker-outcome";

export type { PickedFile, PickFileOutcome } from "./file-picker-outcome";

export async function pickImageWithOutcome(): Promise<PickFileOutcome> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { status: "denied", source: "library" };

  try {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.8 });
    if (result.canceled || !result.assets[0]) return { status: "cancelled", source: "library" };
    return {
      status: "selected",
      source: "library",
      file: pickedFileFromAsset(result.assets[0], Date.now(), "image"),
    };
  } catch (error) {
    return {
      status: "error",
      source: "library",
      message: error instanceof Error ? error.message : "Could not open your photo library.",
    };
  }
}

export async function takePhotoWithOutcome(): Promise<PickFileOutcome> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { status: "denied", source: "camera" };

  try {
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return { status: "cancelled", source: "camera" };
    return {
      status: "selected",
      source: "camera",
      file: pickedFileFromAsset(result.assets[0], Date.now(), "photo"),
    };
  } catch (error) {
    return {
      status: "error",
      source: "camera",
      message: error instanceof Error ? error.message : "Could not open the camera.",
    };
  }
}

export async function pickImage(): Promise<PickedFile | null> {
  const outcome = await pickImageWithOutcome();
  return outcome.status === "selected" ? outcome.file : null;
}

export async function takePhoto(): Promise<PickedFile | null> {
  const outcome = await takePhotoWithOutcome();
  return outcome.status === "selected" ? outcome.file : null;
}
