import {
  CefrLevel,
  ListeningMediaProvider,
  ListeningMediaType,
  ListeningMode,
} from '@prisma/client';

// Sprint 11 — the response shapes.
//
// THE STUDENT AND ADMIN SEGMENT SHAPES ARE DIFFERENT TYPES, not one type with
// optional fields. Two fields must never reach a student:
//
//   normalizedText — the exact string a future attempt will be graded against.
//                    Shipping it would hand the client the answer key to the
//                    comparison, and it has no rendering use whatsoever.
//   notes          — the author's working notes.
//
// Making them structurally absent is the same technique STUDENT_QUESTION_SELECT
// uses for correctAnswer/explanation in the quiz engine: a field that does not
// exist on the type cannot be leaked by a forgotten `select`.

export interface ListeningCategoryDto {
  id: string;
  name: string;
  nameVi: string;
  orderIndex: number;
}

/** Admin view — carries publication state and how much content is underneath. */
export interface ManageListeningCategoryDto extends ListeningCategoryDto {
  isPublished: boolean;
  contentCount: number;
}

/** A catalog card. No segments — the list ships counts, not transcripts. */
export interface ListeningCardDto {
  id: string;
  title: string;
  description: string | null;
  level: CefrLevel;
  thumbnailUrl: string | null;
  durationMs: number | null;
  segmentCount: number;
  supportedModes: ListeningMode[];
  sourceName: string | null;
  category: ListeningCategoryDto;
}

export interface StudentListeningSegmentDto {
  id: string;
  orderIndex: number;
  text: string;
  ipa: string | null;
  translationVi: string | null;
  startTimeMs: number;
  endTimeMs: number;
}

export interface ListeningContentDetailDto {
  id: string;
  title: string;
  description: string | null;
  level: CefrLevel;
  thumbnailUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  mediaType: ListeningMediaType;
  mediaProvider: ListeningMediaProvider;
  mediaUrl: string;
  externalMediaId: string | null;
  durationMs: number | null;
  supportedModes: ListeningMode[];
  category: ListeningCategoryDto;
  segments: StudentListeningSegmentDto[];
}

export interface ManageListeningSegmentDto extends StudentListeningSegmentDto {
  notes: string | null;
}

export interface ManageListeningContentDto {
  id: string;
  title: string;
  description: string | null;
  level: CefrLevel;
  thumbnailUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  mediaType: ListeningMediaType;
  mediaProvider: ListeningMediaProvider;
  mediaUrl: string;
  externalMediaId: string | null;
  durationMs: number | null;
  supportedModes: ListeningMode[];
  orderIndex: number;
  isPublished: boolean;
  categoryId: string;
  category: ManageListeningCategoryDto;
  segmentCount: number;
  segments: ManageListeningSegmentDto[];
  createdAt: Date;
  updatedAt: Date;
}

/** Row shape for the admin content list — no segments, same as the card. */
export interface ManageListeningContentSummaryDto {
  id: string;
  title: string;
  level: CefrLevel;
  mediaProvider: ListeningMediaProvider;
  mediaType: ListeningMediaType;
  supportedModes: ListeningMode[];
  orderIndex: number;
  isPublished: boolean;
  segmentCount: number;
  category: ListeningCategoryDto & { isPublished: boolean };
  updatedAt: Date;
}

export interface PaginationMetaDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListeningCatalogResponseDto {
  data: ListeningCardDto[];
  meta: PaginationMetaDto;
  /**
   * Every category that currently HAS visible content, with a real count.
   *
   * Derived from the same publication predicate the list uses, so a chip can
   * never advertise a number the grid cannot produce. A category with nothing
   * published is absent rather than shown as `(0)` — an empty section is a
   * dead end for the student and an accidental disclosure that drafts exist.
   */
  categories: (ListeningCategoryDto & { contentCount: number })[];
}
