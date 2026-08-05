// Sprint 11 — YouTube URL validation, backend side.
//
// A DELIBERATE SECOND IMPLEMENTATION, not an oversight. The frontend already
// has `components/lesson/video/youtubeUrlParser.ts`, but the two apps are
// separate git repositories with no shared package, so there is no import that
// could reach it. The rules below are kept line-comparable with that file for
// the same reason `lessonHasTheory` is kept line-comparable with
// `parseGrammarNotes`: if they drift, an admin can save a URL that publishes
// here and renders as "video unavailable" there.
//
// Supported: watch?v=, youtu.be/, embed/. Shorts is rejected on both sides.
//
// NOTHING HERE FETCHES ANYTHING. Validation is structural only — the backend
// never calls YouTube, never downloads a video, and never requests captions or
// a transcript. Whether a video id actually resolves is the player's problem
// (it already renders an honest "unavailable" state), and a network call on
// the publish path would make publishing fail when YouTube is slow.

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

/** The bare 11-character video id, or null when this is not a usable URL. */
export function parseYouTubeVideoId(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id && VIDEO_ID_RE.test(id) ? id : null;
    }
    if (parsed.pathname.startsWith('/embed/')) {
      const id = parsed.pathname.slice('/embed/'.length).split('/')[0];
      return id && VIDEO_ID_RE.test(id) ? id : null;
    }
    // /shorts/... and everything else on a YouTube host.
    return null;
  }

  return null;
}

/** True for any syntactically valid absolute https URL. */
export function isHttpsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
