import React, { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';

type ProfileAvatarImageProps = {
  uri?: string | null;
  style: StyleProp<ImageStyle>;
  recyclingKey?: string;
  transition?: number;
  children: React.ReactNode;
};

export function ProfileAvatarImage({
  uri,
  style,
  recyclingKey,
  transition = 160,
  children,
}: ProfileAvatarImageProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [uri]);

  if (!uri || loadFailed) {
    return <>{children}</>;
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={recyclingKey ?? uri}
      transition={transition}
      onError={() => setLoadFailed(true)}
    />
  );
}
