export const GALLERY_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const GALLERY_STORED_MAX_BYTES = 2 * 1024 * 1024;
export const GALLERY_IMAGE_MAX_EDGE = 2048;
export const GALLERY_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateGalleryUpload(file) {
  if (!file || !GALLERY_UPLOAD_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > GALLERY_SOURCE_MAX_BYTES) throw new Error('Choose a photo no larger than 10 MB.');
  return true;
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This photo could not be optimized. Try a different image.')), 'image/webp', quality);
  });
}

export async function optimizeGalleryUpload(file, {
  createImageBitmapImpl = globalThis.createImageBitmap,
  documentImpl = globalThis.document
} = {}) {
  validateGalleryUpload(file);
  if (typeof createImageBitmapImpl !== 'function' || !documentImpl?.createElement) throw new Error('This browser cannot optimize photos. Try a recent browser.');
  let bitmap;
  try {
    bitmap = await createImageBitmapImpl(file);
    const scale = Math.min(1, GALLERY_IMAGE_MAX_EDGE / bitmap.width, GALLERY_IMAGE_MAX_EDGE / bitmap.height);
    const canvas = documentImpl.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This photo could not be optimized. Try a different image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.76, 0.68, 0.58, 0.48]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob.type !== 'image/webp') throw new Error('This browser cannot create WebP photos. Try a recent browser.');
      if (blob.size <= GALLERY_STORED_MAX_BYTES) return blob;
    }
    throw new Error('This photo is still larger than 2 MB after optimization. Choose a smaller photo.');
  } catch (error) {
    if (error instanceof Error && /^(Choose|This browser|This photo)/.test(error.message)) throw error;
    throw new Error('This photo could not be opened. Choose a JPEG, PNG, or WebP image.');
  } finally {
    bitmap?.close?.();
  }
}