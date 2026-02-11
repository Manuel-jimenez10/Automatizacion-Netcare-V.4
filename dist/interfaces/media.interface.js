"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMimeCategory = exports.ALLOWED_MIME_TYPES = void 0;
// MIME types permitidos
exports.ALLOWED_MIME_TYPES = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    // Audio
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/amr', 'audio/aac',
    // Video
    'video/mp4', 'video/mpeg', 'video/3gpp',
    // Documents
    'application/pdf'
];
const getMimeCategory = (mimeType) => {
    if (mimeType.startsWith('image/'))
        return 'image';
    if (mimeType.startsWith('audio/'))
        return 'voice_note';
    if (mimeType.startsWith('video/'))
        return 'video';
    return 'document';
};
exports.getMimeCategory = getMimeCategory;
