/**
 * The image-upload bounds the browser picker and the server route share
 * (Task D3, spec §5.4).
 *
 * The engine has no documented image size limit (probed 2026-09-18: it
 * accepted a 5.88 MiB PNG), so {@link IMAGE_UPLOAD_MAX_BYTES} is UniPilot's
 * own bound — generous for slide imagery, bounded for one multipart request.
 * The adapter re-exports it under its `PRESENTON_IMAGE_*` name; the client
 * picker imports it directly (this module is pure, so no server code reaches
 * the browser).
 */

/** UniPilot's browser-upload bound for one image. */
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** The engine's `ALLOWED_UPLOAD_IMAGE_EXTENSIONS` (`images.py`). */
export const IMAGE_UPLOAD_EXTENSIONS = [
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
] as const;
