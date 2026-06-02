import { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import {
  filePickerFeedbackForOutcome,
  type PickedFile,
  type PickFileOutcome,
} from '@/lib/file-picker-outcome';
import { pickImageWithOutcome, takePhotoWithOutcome } from '@/lib/file-picker';
import { uploadFile } from '@/lib/upload';

type Feedback = {
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'info';
};

type UseProfilePhotoUploadOptions = {
  onUploaded: (imageUrl: string) => Promise<void> | void;
  onFeedback: (feedback: Feedback) => void;
  successFeedback?: boolean;
};

type UploadProfileImageResult = {
  imageUrl: string;
};

export function useProfilePhotoUpload({
  onUploaded,
  onFeedback,
  successFeedback = true,
}: UseProfilePhotoUploadOptions) {
  const [photoSourceVisible, setPhotoSourceVisible] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (pickedFile: PickedFile): Promise<UploadProfileImageResult> => {
      const uploadResult = await uploadFile(pickedFile.uri, pickedFile.filename, pickedFile.mimeType);
      await api.put('/api/profile/image', { imageUrl: uploadResult.url });
      return { imageUrl: uploadResult.url };
    },
    onSuccess: async ({ imageUrl }) => {
      await onUploaded(imageUrl);
      if (successFeedback) {
        onFeedback({
          title: 'Photo Updated',
          message: 'Your profile photo has been updated.',
          variant: 'success',
        });
      }
    },
    onError: () => {
      onFeedback({
        title: 'Upload Failed',
        message: 'There was an error uploading your photo. Please try again.',
        variant: 'error',
      });
    },
  });

  const isUploading = uploadMutation.isPending;
  const isBusy = isPicking || isUploading;

  const handleOutcome = useCallback((outcome: PickFileOutcome) => {
    const feedback = filePickerFeedbackForOutcome(outcome);
    if (feedback) onFeedback(feedback);
    if (outcome.status === 'selected') {
      uploadMutation.mutate(outcome.file);
    }
  }, [onFeedback, uploadMutation]);

  const runPicker = useCallback(async (picker: () => Promise<PickFileOutcome>) => {
    if (isBusy) return;
    setIsPicking(true);
    try {
      handleOutcome(await picker());
    } catch {
      onFeedback({
        title: 'Photo Not Added',
        message: 'Could not open photos on this device.',
        variant: 'error',
      });
    } finally {
      setIsPicking(false);
    }
  }, [handleOutcome, isBusy, onFeedback]);

  const openPhotoSource = useCallback(() => {
    if (isBusy) return;
    setPhotoSourceVisible(true);
  }, [isBusy]);

  const closePhotoSource = useCallback(() => {
    setPhotoSourceVisible(false);
  }, []);

  const takePhoto = useCallback(() => {
    void runPicker(takePhotoWithOutcome);
  }, [runPicker]);

  const chooseLibrary = useCallback(() => {
    void runPicker(pickImageWithOutcome);
  }, [runPicker]);

  const uploadProgressLabel = useMemo(() => {
    if (isUploading) return 'Uploading photo...';
    if (isPicking) return 'Opening photos...';
    return null;
  }, [isPicking, isUploading]);

  return {
    chooseLibrary,
    closePhotoSource,
    isBusy,
    isPicking,
    isUploading,
    openPhotoSource,
    photoSourceVisible,
    takePhoto,
    uploadProgressLabel,
  };
}
