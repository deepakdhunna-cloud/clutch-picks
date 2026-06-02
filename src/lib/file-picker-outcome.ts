export type PickedFile = { uri: string; filename: string; mimeType: string };
export type PickFileSource = 'camera' | 'library';
export type PickFileOutcome =
  | { status: 'selected'; source: PickFileSource; file: PickedFile }
  | { status: 'cancelled'; source: PickFileSource }
  | { status: 'denied'; source: PickFileSource }
  | { status: 'error'; source: PickFileSource; message: string };

type AssetLike = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export function pickedFileFromAsset(
  asset: AssetLike,
  now = Date.now(),
  fallbackPrefix = 'image',
): PickedFile {
  return {
    uri: asset.uri,
    filename: asset.fileName ?? `${fallbackPrefix}-${now}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
  };
}

export function filePickerFeedbackForOutcome(outcome: PickFileOutcome): {
  title: string;
  message: string;
  variant: 'success' | 'error' | 'info';
} | null {
  if (outcome.status === 'cancelled') return null;

  if (outcome.status === 'denied') {
    const isCamera = outcome.source === 'camera';
    return {
      title: isCamera ? 'Camera Permission Needed' : 'Photo Permission Needed',
      message: isCamera
        ? 'Allow camera access in Settings to take a profile photo.'
        : 'Allow photo library access in Settings to choose a profile photo.',
      variant: 'info',
    };
  }

  if (outcome.status === 'error') {
    return {
      title: 'Photo Not Added',
      message: outcome.message,
      variant: 'error',
    };
  }

  return null;
}
