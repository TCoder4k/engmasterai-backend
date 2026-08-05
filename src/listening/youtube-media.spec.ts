import { isHttpsUrl, parseYouTubeVideoId } from './youtube-media';

// Sprint 11 — kept line-comparable with the frontend's
// components/lesson/video/youtubeUrlParser.ts. The two repositories cannot
// share code, so this suite is what stops them drifting: a URL that publishes
// here must be one that player can actually render.

describe('parseYouTubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    // The privacy-enhanced host the player actually embeds through.
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('accepts %s', (url, expected) => {
    expect(parseYouTubeVideoId(url)).toBe(expected);
  });

  it('rejects Shorts', () => {
    // Rejected on the frontend too. Accepting it here would let an admin
    // publish content the player renders as "unavailable".
    expect(
      parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    ).toBeNull();
  });

  it.each([
    ['a non-YouTube host', 'https://vimeo.com/123456789'],
    ['a malformed URL', 'not a url'],
    ['an id of the wrong length', 'https://youtu.be/tooshort'],
    ['a channel page', 'https://www.youtube.com/@bbclearningenglish'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(parseYouTubeVideoId(url)).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(parseYouTubeVideoId(null)).toBeNull();
    expect(parseYouTubeVideoId(undefined)).toBeNull();
  });
});

describe('isHttpsUrl', () => {
  it('accepts https', () => {
    expect(isHttpsUrl('https://cdn.example.com/a.mp3')).toBe(true);
  });

  it('rejects http', () => {
    expect(isHttpsUrl('http://cdn.example.com/a.mp3')).toBe(false);
  });

  it('rejects a relative path and empty input', () => {
    expect(isHttpsUrl('/a.mp3')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });
});
