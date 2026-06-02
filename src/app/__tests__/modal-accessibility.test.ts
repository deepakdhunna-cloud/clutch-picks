import fs from 'fs';
import path from 'path';

const photoSourceModal = fs.readFileSync(
  path.join(process.cwd(), 'src/components/PhotoSourceModal.tsx'),
  'utf8',
);
const feedbackModal = fs.readFileSync(
  path.join(process.cwd(), 'src/components/FeedbackModal.tsx'),
  'utf8',
);
const pickConfirmationModal = fs.readFileSync(
  path.join(process.cwd(), 'src/components/sports/PickConfirmationModal.tsx'),
  'utf8',
);
const errorBoundary = fs.readFileSync(
  path.join(process.cwd(), 'src/components/ErrorBoundary.tsx'),
  'utf8',
);
const confirmModal = fs.readFileSync(
  path.join(process.cwd(), 'src/components/ConfirmModal.tsx'),
  'utf8',
);

describe('shared modal accessibility', () => {
  it('keeps the photo source sheet actions reachable as separate buttons', () => {
    expect(photoSourceModal).toContain('accessible={false}');
    expect(photoSourceModal).toContain('accessibilityViewIsModal');
    expect(photoSourceModal).toContain('accessibilityRole="header"');
    expect(photoSourceModal).toContain('accessibilityLabel="Take Photo"');
    expect(photoSourceModal).toContain('accessibilityLabel="Choose from Library"');
    expect(photoSourceModal).toContain('accessibilityLabel="Cancel"');
    expect(photoSourceModal).toContain('height: 54');
    expect(photoSourceModal).toContain('style={StyleSheet.absoluteFill}');
    expect(photoSourceModal).toContain('styles.backdropRoot');
    expect(photoSourceModal).toContain('style={[styles.actionButton, styles.cameraButton]}');
    expect(photoSourceModal).toContain('style={[styles.actionButton, styles.libraryButton]}');
    expect(photoSourceModal).toContain('pressed ? styles.pressedAction : null');
    expect(photoSourceModal).not.toContain('TouchableOpacity');
  });

  it('names feedback modal dismissal as a button', () => {
    expect(feedbackModal).toContain('accessibilityViewIsModal');
    expect(feedbackModal).toContain('accessibilityRole="header"');
    expect(feedbackModal).toContain('accessibilityRole="button"');
    expect(feedbackModal).toContain('accessibilityLabel={actionLabel}');
    expect(feedbackModal).toContain('Pressable');
    expect(feedbackModal).not.toContain('TouchableOpacity');
    expect(feedbackModal).toContain("width: '100%'");
    expect(feedbackModal).toContain('height: 46');
  });

  it('can show a secondary recovery action without trapping the user', () => {
    expect(feedbackModal).toContain('secondaryActionLabel?: string;');
    expect(feedbackModal).toContain('onActionPress?: () => void;');
    expect(feedbackModal).toContain('onSecondaryPress?: () => void;');
    expect(feedbackModal).toContain('accessibilityLabel={secondaryActionLabel}');
    expect(feedbackModal).toContain('secondaryActionLabel ? (');
  });

  it('labels pick confirmation dismissal and confirm actions', () => {
    expect(pickConfirmationModal).toContain('accessibilityViewIsModal');
    expect(pickConfirmationModal).toContain('accessibilityRole="button"');
    expect(pickConfirmationModal).toContain('accessibilityLabel="Dismiss pick confirmation"');
    expect(pickConfirmationModal).toContain('accessibilityLabel="Close pick confirmation"');
    expect(pickConfirmationModal).toContain('accessibilityLabel={primaryLabel}');
    expect(pickConfirmationModal).toContain('accessibilityState={{ disabled: isConfirming }}');
  });

  it('labels app error recovery actions', () => {
    expect(errorBoundary).toContain('accessibilityRole="button"');
    expect(errorBoundary).toContain('accessibilityLabel="Try again"');
    expect(errorBoundary).toContain('accessibilityLabel="Go back"');
  });

  it('labels shared confirmation modal actions', () => {
    expect(confirmModal).toContain('accessibilityViewIsModal');
    expect(confirmModal).toContain('accessibilityRole="header"');
    expect(confirmModal).toContain('accessibilityLabel={title}');
    expect(confirmModal).toContain('accessibilityLabel={cancelLabel}');
    expect(confirmModal).toContain('accessibilityLabel={confirmLabel}');
    expect(confirmModal).toContain('minHeight: 44');
  });
});
