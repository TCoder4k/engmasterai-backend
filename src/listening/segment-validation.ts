import {
  ListeningMediaProvider,
  ListeningMediaType,
  ListeningMode,
} from '@prisma/client';
import { isHttpsUrl, parseYouTubeVideoId } from './youtube-media';

// Sprint 11 — every rule that decides whether listening content is coherent.
//
// Pure: no Prisma, no clock, no I/O. Returns a MESSAGE rather than throwing,
// so the caller chooses the exception type and the tests can assert the exact
// text an admin will read.
//
// TWO TIERS, AND THE SPLIT IS THE WHOLE DESIGN.
//
//   WRITE-TIME (validateSegmentDocument) — rules a segment can never sensibly
//   break, checked on every save. A sentence with no text, or one that ends
//   before it starts, is not "incomplete", it is wrong.
//
//   PUBLISH-TIME (validateContentForPublish) — rules about the document AS A
//   WHOLE. Overlapping timestamps, a missing recording, no enabled mode. A
//   DRAFT IS ALLOWED TO FAIL ALL OF THESE. That is what a draft is for: an
//   admin transcribing a nine-minute recording saves twenty times before the
//   segments tile correctly, and a save that refuses half-finished work would
//   make the editor unusable.
//
// The five migrated seed recordings live in exactly that state — real
// transcripts, no legally cleared media — and are why `mediaUrl` is checked
// here instead of being a NOT NULL constraint.

/** Longest a single sentence may be for shadowing. Mirrors the 30s recorder cap. */
export const MAX_SHADOWING_SEGMENT_MS = 30_000;

export interface SegmentDraft {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
}

export interface ContentPublishDraft {
  supportedModes: ListeningMode[];
  mediaType: ListeningMediaType;
  mediaProvider: ListeningMediaProvider;
  mediaUrl: string;
  sourceName: string | null;
  sourceUrl: string | null;
  durationMs: number | null;
  categoryIsPublished: boolean;
  segments: SegmentDraft[];
}

// --- write-time ------------------------------------------------------------

/**
 * Per-segment sanity, applied on every save including drafts.
 *
 * Segments arrive as an ARRAY and their position IS their orderIndex — the
 * same contract `UpsertQuizDto.questions` uses, which is why neither has a
 * separate reorder endpoint. Reordering is saving the array in a new order.
 */
export const validateSegmentDocument = (
  segments: SegmentDraft[],
): string | null => {
  for (const [index, segment] of segments.entries()) {
    const position = index + 1;

    if (!segment.text.trim()) {
      return `Segment ${position}: text must not be empty.`;
    }
    if (!Number.isInteger(segment.startTimeMs) || segment.startTimeMs < 0) {
      return `Segment ${position}: startTimeMs must be an integer of 0 or more.`;
    }
    if (!Number.isInteger(segment.endTimeMs)) {
      return `Segment ${position}: endTimeMs must be an integer.`;
    }
    if (segment.endTimeMs <= segment.startTimeMs) {
      return `Segment ${position}: endTimeMs (${segment.endTimeMs}) must be greater than startTimeMs (${segment.startTimeMs}).`;
    }
  }

  return null;
};

// --- publish-time ----------------------------------------------------------

/**
 * Everything that must hold before students can be shown this content.
 *
 * Ordered so the message an admin sees names the FIRST thing worth fixing:
 * "no segments" is more useful than "segment 1 overlaps segment 2" when both
 * are true.
 */
export const validateContentForPublish = (
  draft: ContentPublishDraft,
): string | null => {
  // 1 — the category gate. Publishing into a draft category produces content
  // no student can reach (see listening-visibility.ts), which looks exactly
  // like a bug from the admin's side. Refuse it with the real reason.
  if (!draft.categoryIsPublished) {
    return 'Cannot publish: the category is still a draft. Publish the category first.';
  }

  // 2 — at least one mode. Content with no enabled mode is unreachable content.
  if (draft.supportedModes.length === 0) {
    return 'Cannot publish: enable at least one practice mode.';
  }

  // 3 — media.
  const mediaError = validateMedia(draft);
  if (mediaError) return mediaError;

  // 4 — at least one segment.
  if (draft.segments.length === 0) {
    return 'Cannot publish: add at least one segment.';
  }

  // 5 — per-segment sanity (also enforced on save; re-checked because a draft
  // saved by an earlier version of these rules must not slip through).
  const segmentError = validateSegmentDocument(draft.segments);
  if (segmentError) return `Cannot publish: ${lowerFirst(segmentError)}`;

  // 6 — chronological order and no overlap.
  //
  // Checked against the ARRAY order rather than a sorted copy, on purpose: the
  // array order is what becomes orderIndex, so a document whose sentence 3
  // plays before sentence 2 would show the student a subtitle list that
  // disagrees with the audio.
  for (let i = 1; i < draft.segments.length; i += 1) {
    const previous = draft.segments[i - 1];
    const current = draft.segments[i];

    if (current.startTimeMs < previous.endTimeMs) {
      return `Cannot publish: segment ${i + 1} starts at ${current.startTimeMs}ms, before segment ${i} ends at ${previous.endTimeMs}ms.`;
    }
  }

  // 7 — nothing may run past the recording.
  if (draft.durationMs !== null) {
    for (const [index, segment] of draft.segments.entries()) {
      if (segment.endTimeMs > draft.durationMs) {
        return `Cannot publish: segment ${index + 1} ends at ${segment.endTimeMs}ms, past the media duration of ${draft.durationMs}ms.`;
      }
    }
  }

  // 8 — shadowing needs sentences a learner can actually repeat in one breath,
  // and that the 30-second recorder can capture.
  if (draft.supportedModes.includes(ListeningMode.SHADOWING)) {
    for (const [index, segment] of draft.segments.entries()) {
      const length = segment.endTimeMs - segment.startTimeMs;
      if (length > MAX_SHADOWING_SEGMENT_MS) {
        return `Cannot publish: segment ${index + 1} is ${length}ms long, over the ${MAX_SHADOWING_SEGMENT_MS}ms limit for shadowing. Split it or disable shadowing.`;
      }
    }
  }

  return null;
};

const validateMedia = (draft: ContentPublishDraft): string | null => {
  if (!draft.mediaUrl.trim()) {
    return 'Cannot publish: add a media URL.';
  }

  if (draft.mediaProvider === ListeningMediaProvider.YOUTUBE) {
    if (draft.mediaType !== ListeningMediaType.VIDEO) {
      return 'Cannot publish: a YouTube source must be of media type VIDEO.';
    }
    if (!parseYouTubeVideoId(draft.mediaUrl)) {
      return 'Cannot publish: the media URL is not a supported YouTube video URL (watch, youtu.be or embed — Shorts is not supported).';
    }
    // Attribution is REQUIRED for embedded third-party media. The video is
    // shown inside our player, so the channel it belongs to has to stay
    // visible and linkable to the student.
    if (!draft.sourceName?.trim()) {
      return 'Cannot publish: a YouTube source requires a source/channel name for attribution.';
    }
    if (!isHttpsUrl(draft.sourceUrl)) {
      return 'Cannot publish: a YouTube source requires an https source URL for attribution.';
    }
    return null;
  }

  if (!isHttpsUrl(draft.mediaUrl)) {
    return 'Cannot publish: the media URL must be an absolute https URL.';
  }

  return null;
};

const lowerFirst = (text: string): string =>
  text.charAt(0).toLowerCase() + text.slice(1);
