export type MediaCategory = 'image' | 'voice_note' | 'video' | 'document';

export interface UploadedMediaResult {
  success: boolean;
  url: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  category: MediaCategory;
  size: number;
}

export interface WhatsappMediaRecord {
  id?: string;
  messageId?: string | null;
  url: string;
  mimeType: string;
  category: MediaCategory;
  fileName: string;
  size: number;
  createdAt?: string;
}

export interface SendMediaRequest {
  to: string;
  mediaIds?: string[];      // IDs de WhatsappMedia en EspoCRM
  mediaUrls?: string[];     // URLs directas (alternativa)
  body?: string;            // Caption opcional
}

// MIME types permitidos
export const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  // Audio
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/amr', 'audio/aac',
  // Video
  'video/mp4', 'video/mpeg', 'video/3gpp',
  // Documents
  'application/pdf'
];

export const getMimeCategory = (mimeType: string): MediaCategory => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'voice_note';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
};
