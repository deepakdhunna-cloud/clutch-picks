// Discussion Board Types

export interface User {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isVerified?: boolean;
}

export interface Post {
  id: string;
  user: User;
  content: string;
  imageUrl?: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  sport?: string;
  gameId?: string;
}

export interface Comment {
  id: string;
  postId: string;
  user: User;
  content: string;
  createdAt: string;
  likeCount: number;
  isLiked: boolean;
}

export interface CreatePostInput {
  content: string;
  imageUri?: string;
  sport?: string;
  gameId?: string;
}

export interface CreateCommentInput {
  postId: string;
  content: string;
}

// News Types for Confidence System
export type NewsSentiment = 'positive' | 'negative' | 'neutral';

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  sentiment: NewsSentiment;
  confidenceImpact: number; // -20 to +20
  teamId?: string;
  playerId?: string;
  sport: string;
  imageUrl?: string;
}

export interface ConfidenceAdjustment {
  gameId: string;
  baseConfidence: number;
  adjustedConfidence: number;
  newsItems: NewsItem[];
  totalImpact: number;
}
