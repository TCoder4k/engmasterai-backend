// Matches the allowed sets already used by the existing per-word upload
// endpoints (POST /vocab/words/:id/audio and /:id/image) — one place so the
// analyzer, validator, and resolver never drift on what "counts" as media.
export const AUDIO_EXTENSIONS = ['.mp3', '.mp4', '.ogg', '.wav', '.webm'];
export const IMAGE_EXTENSIONS = ['.jpeg', '.png', '.jpg', '.webp'];
