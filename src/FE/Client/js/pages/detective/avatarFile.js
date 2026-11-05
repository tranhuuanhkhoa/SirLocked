import { tr } from '../../services/i18n.js';

/*
 * Turns what a player picks, on a computer or from a phone's gallery, into a small square ready to send.
 * A phone photo runs to many megabytes, can be in a format the server does not read, and often stands upright only
 * through a metadata tag. The server keeps 256px of it, so the browser does the heavy part: it can read whatever the
 * device takes and honours that tag when drawing. The server still checks and re-encodes what arrives.
 */
const OUTPUT_SIDE = 512;
const OUTPUT_QUALITY = 0.9;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/* a transparent picture sits on the same dark as the avatar tiles */
const BACKDROP = '#0c0e14';

/** A file that cannot become an avatar. Its message is ready to show. */
export class AvatarFileProblem extends Error {}

const encode = (canvas, type) => new Promise((resolve) => { canvas.toBlob(resolve, type, OUTPUT_QUALITY); });
const unreadable = () => new AvatarFileProblem(tr('This picture could not be read. Please choose a JPG, PNG or WebP one.', 'Không đọc được ảnh này. Hãy chọn ảnh JPG, PNG hoặc WebP.'));

async function readPicture(url) {
  const picture = new Image();
  picture.src = url;
  try {
    await picture.decode();
  } catch {
    throw unreadable();
  }
  if (!picture.naturalWidth || !picture.naturalHeight) throw unreadable();
  return picture;
}

/** @param {File} file @returns {Promise<File>} the middle of the picture as a square, at most 512px a side */
export async function squareAvatar(file) {
  if (file.size > MAX_SOURCE_BYTES) throw new AvatarFileProblem(tr('The picture must be 40 MB or smaller.', 'Ảnh phải từ 40 MB trở xuống.'));
  if (file.type === 'image/svg+xml') throw new AvatarFileProblem(tr('Use a JPG, PNG or WebP picture.', 'Hãy dùng ảnh JPG, PNG hoặc WebP.'));

  const url = URL.createObjectURL(file);
  try {
    const picture = await readPicture(url);
    const width = picture.naturalWidth, height = picture.naturalHeight, crop = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(OUTPUT_SIDE, crop);
    const context = canvas.getContext('2d');
    context.fillStyle = BACKDROP;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(picture, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, canvas.width, canvas.height);

    // Safari reads WebP but does not write it, and answers with a much larger PNG instead.
    let blob = await encode(canvas, 'image/webp');
    if (blob?.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg');
    if (!blob) throw unreadable();
    return new File([blob], blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg', { type: blob.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}
