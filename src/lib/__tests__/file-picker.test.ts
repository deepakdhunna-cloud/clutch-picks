import {
  filePickerFeedbackForOutcome,
  pickedFileFromAsset,
  type PickFileOutcome,
} from '../file-picker-outcome';

describe('file picker outcomes', () => {
  it('normalizes picked image assets into uploadable files', () => {
    expect(pickedFileFromAsset({
      uri: 'file:///photo.png',
      fileName: 'avatar.png',
      mimeType: 'image/png',
    })).toEqual({
      uri: 'file:///photo.png',
      filename: 'avatar.png',
      mimeType: 'image/png',
    });
  });

  it('uses safe fallbacks when native asset metadata is incomplete', () => {
    const file = pickedFileFromAsset({ uri: 'file:///photo' }, 1234, 'photo');
    expect(file.filename).toBe('photo-1234.jpg');
    expect(file.mimeType).toBe('image/jpeg');
  });

  it('distinguishes cancel from denied permission for profile photo UX', () => {
    const cancelled: PickFileOutcome = { status: 'cancelled', source: 'library' };
    const denied: PickFileOutcome = { status: 'denied', source: 'camera' };

    expect(filePickerFeedbackForOutcome(cancelled)).toBeNull();
    expect(filePickerFeedbackForOutcome(denied)).toEqual({
      title: 'Camera Permission Needed',
      message: 'Allow camera access in Settings to take a profile photo.',
      variant: 'info',
    });
  });
});
