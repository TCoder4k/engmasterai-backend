import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { WordSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../shared/services/cloudinary.service';
import { CreateVocabWordDto } from './dto/create-vocab-word.dto';
import { UpdateVocabWordDto } from './dto/update-vocab-word.dto';
import { QueryVocabWordDto } from './dto/query-vocab-word.dto';

const MAX_LIMIT = 100;
const MAX_CSV_ROWS = 1000;

const MEANING_SELECT = {
  id: true,
  partOfSpeech: true,
  meaning: true,
  orderIndex: true,
};

const EXAMPLE_SELECT = {
  id: true,
  sentence: true,
  translation: true,
  orderIndex: true,
};

// Bank list — one row per word plus enough counts to inform admin triage
// (how many meanings/examples it has, how many decks it's used in) without
// fetching the full nested content.
const BANK_LIST_SELECT = {
  id: true,
  text: true,
  ipa: true,
  cefrLevel: true,
  audioUrl: true,
  imageUrl: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { meanings: true, examples: true, deckWords: true },
  },
};

// Full editor shape — the codebase's first admin single-item GET exists
// specifically so this page can be deep-linked/refreshed without relying on
// an already-fetched list row (see the Phase 2 plan §2/§5).
const EDITOR_SELECT = {
  id: true,
  text: true,
  ipa: true,
  audioUrl: true,
  imageUrl: true,
  cefrLevel: true,
  synonyms: true,
  antonyms: true,
  collocations: true,
  wordFamily: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  meanings: {
    select: MEANING_SELECT,
    orderBy: { orderIndex: 'asc' as const },
  },
  examples: {
    select: EXAMPLE_SELECT,
    orderBy: { orderIndex: 'asc' as const },
  },
  _count: {
    select: { deckWords: true },
  },
};

// No `source` here — provenance (admin-created / imported / AI-generated)
// is admin-only information, not part of the student-facing shape.
const STUDENT_DETAIL_SELECT = {
  id: true,
  text: true,
  ipa: true,
  audioUrl: true,
  imageUrl: true,
  cefrLevel: true,
  synonyms: true,
  antonyms: true,
  collocations: true,
  wordFamily: true,
  meanings: {
    select: MEANING_SELECT,
    orderBy: { orderIndex: 'asc' as const },
  },
  examples: {
    select: EXAMPLE_SELECT,
    orderBy: { orderIndex: 'asc' as const },
  },
};

interface CsvCandidate {
  dto: CreateVocabWordDto;
  normalizedText: string;
}

@Injectable()
export class VocabWordService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async findAllManage(query: QueryVocabWordDto) {
    const take = Math.min(query.limit || 10, MAX_LIMIT);
    const skip = query.page ? (query.page - 1) * take : 0;

    const where = {
      ...(query.search && {
        text: { contains: query.search, mode: 'insensitive' as const },
      }),
      ...(query.cefrLevel && { cefrLevel: query.cefrLevel }),
    };

    const [words, total] = await Promise.all([
      this.prismaService.vocabWord.findMany({
        where,
        skip,
        take,
        select: BANK_LIST_SELECT,
        orderBy: { text: 'asc' },
      }),
      this.prismaService.vocabWord.count({ where }),
    ]);

    return {
      data: words,
      meta: {
        total,
        page: query.page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findOneManage(id: string) {
    const word = await this.prismaService.vocabWord.findUnique({
      where: { id },
      select: EDITOR_SELECT,
    });

    if (!word) {
      throw new NotFoundException(`Vocabulary word with ID ${id} not found`);
    }

    return word;
  }

  // The visibility seam (architecture H1): a word is visible to a student
  // iff it sits on at least one published deck of a published library.
  // Phase 3's review-submission validation and queue builders must reuse
  // this exact filter rather than re-deriving visibility (see Phase 2→3
  // handoff #1 in the approved plan).
  async findOneVisibleToUser(id: string, _user: { userId: string }) {
    const word = await this.prismaService.vocabWord.findFirst({
      where: {
        id,
        deckWords: {
          some: {
            deck: {
              isPublished: true,
              library: { isPublished: true },
            },
          },
        },
      },
      select: STUDENT_DETAIL_SELECT,
    });

    if (!word) {
      throw new NotFoundException(`Vocabulary word with ID ${id} not found`);
    }

    return word;
  }

  // Composite create: the word plus its nested meanings (>=1, enforced by
  // the DTO) and examples, all in one transaction. Every field — including
  // each nested array item — is mapped explicitly rather than spread, since
  // the global ValidationPipe has no whitelist and nested objects carry the
  // same mass-assignment risk as top-level ones.
  async create(dto: CreateVocabWordDto) {
    const wordId = await this.prismaService.$transaction(async (tx) => {
      const word = await tx.vocabWord.create({
        data: {
          text: dto.text,
          ipa: dto.ipa,
          audioUrl: dto.audioUrl,
          imageUrl: dto.imageUrl,
          cefrLevel: dto.cefrLevel,
          synonyms: dto.synonyms ?? [],
          antonyms: dto.antonyms ?? [],
          collocations: dto.collocations ?? [],
          wordFamily: dto.wordFamily ?? [],
        },
      });

      await tx.vocabWordMeaning.createMany({
        data: dto.meanings.map((m, orderIndex) => ({
          wordId: word.id,
          partOfSpeech: m.partOfSpeech,
          meaning: m.meaning,
          orderIndex,
        })),
      });

      if (dto.examples && dto.examples.length > 0) {
        await tx.vocabWordExample.createMany({
          data: dto.examples.map((e, orderIndex) => ({
            wordId: word.id,
            sentence: e.sentence,
            translation: e.translation,
            orderIndex,
          })),
        });
      }

      return word.id;
    });

    return this.findOneManage(wordId);
  }

  // Composite update: explicit-field word update + replace-all semantics
  // for meanings/examples when provided (delete + recreate, array-position
  // orderIndex). Child ids are therefore not stable across edits — nothing
  // references them externally, so this is an accepted trade-off (see the
  // approved plan's Phase 2→3 handoff #5).
  async update(id: string, dto: UpdateVocabWordDto) {
    await this.findOneOrThrow(id);

    await this.prismaService.$transaction(async (tx) => {
      await tx.vocabWord.update({
        where: { id },
        data: {
          ...(dto.text !== undefined && { text: dto.text }),
          ...(dto.ipa !== undefined && { ipa: dto.ipa }),
          ...(dto.audioUrl !== undefined && { audioUrl: dto.audioUrl }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.cefrLevel !== undefined && { cefrLevel: dto.cefrLevel }),
          ...(dto.synonyms !== undefined && { synonyms: dto.synonyms }),
          ...(dto.antonyms !== undefined && { antonyms: dto.antonyms }),
          ...(dto.collocations !== undefined && {
            collocations: dto.collocations,
          }),
          ...(dto.wordFamily !== undefined && { wordFamily: dto.wordFamily }),
        },
      });

      if (dto.meanings !== undefined) {
        await tx.vocabWordMeaning.deleteMany({ where: { wordId: id } });
        await tx.vocabWordMeaning.createMany({
          data: dto.meanings.map((m, orderIndex) => ({
            wordId: id,
            partOfSpeech: m.partOfSpeech,
            meaning: m.meaning,
            orderIndex,
          })),
        });
      }

      if (dto.examples !== undefined) {
        await tx.vocabWordExample.deleteMany({ where: { wordId: id } });
        if (dto.examples.length > 0) {
          await tx.vocabWordExample.createMany({
            data: dto.examples.map((e, orderIndex) => ({
              wordId: id,
              sentence: e.sentence,
              translation: e.translation,
              orderIndex,
            })),
          });
        }
      }
    });

    return this.findOneManage(id);
  }

  async setAudio(id: string, file: Express.Multer.File) {
    await this.findOneOrThrow(id);

    // Cloudinary stores audio under its 'video' resource type.
    const result = await this.cloudinaryService.uploadFile(file, {
      folder: 'vocab/audio',
      resourceType: 'video',
    });

    await this.prismaService.vocabWord.update({
      where: { id },
      data: { audioUrl: result.secure_url },
    });

    return this.findOneManage(id);
  }

  async setImage(id: string, file: Express.Multer.File) {
    await this.findOneOrThrow(id);

    const result = await this.cloudinaryService.uploadFile(file, {
      folder: 'vocab/images',
      resourceType: 'image',
    });

    await this.prismaService.vocabWord.update({
      where: { id },
      data: { imageUrl: result.secure_url },
    });

    return this.findOneManage(id);
  }

  // 400 while attached to any deck — detaching is the explicit, guarded
  // path for removing a bank word decks depend on. P2003 catch as a race
  // backstop (same pattern as VocabLibraryService.remove).
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const attachedCount = await this.prismaService.vocabDeckWord.count({
      where: { wordId: id },
    });

    if (attachedCount > 0) {
      throw new BadRequestException(
        'Cannot delete a word that is attached to a deck. Detach it from all decks first.',
      );
    }

    try {
      await this.prismaService.vocabWord.delete({ where: { id } });
    } catch (error) {
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete a word that is attached to a deck. Detach it from all decks first.',
        );
      }
      throw error;
    }
  }

  // CSV bulk import — see the approved Phase 2 plan §8.
  //
  // Server-side parsing, synchronous (no queue; the row cap below keeps this
  // in-request handling safe). Rows are normalized (trim, enum upper-casing,
  // '|'-split multi-value cells) then validated through the exact same
  // CreateVocabWordDto/class-validator rules the editor uses — no second
  // validation code path. All-or-nothing: any invalid row aborts the whole
  // import with zero writes; rows whose normalized text already exists (in
  // the bank or earlier in the same file) are skips, not errors, so a valid
  // file re-imports idempotently.
  async importFromCsv(buffer: Buffer) {
    let rows: Record<string, string>[];
    try {
      rows = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException('Could not parse the uploaded file as CSV');
    }

    if (rows.length > MAX_CSV_ROWS) {
      throw new BadRequestException(
        `CSV file exceeds the maximum of ${MAX_CSV_ROWS} rows`,
      );
    }

    const rowErrors: { row: number; message: string }[] = [];
    const candidates: CsvCandidate[] = [];
    const seenInFile = new Set<string>();

    rows.forEach((row, index) => {
      const rowNumber = index + 2; // header row + 1-indexing

      const splitMulti = (value?: string): string[] | undefined =>
        value
          ? value
              .split('|')
              .map((v) => v.trim())
              .filter((v) => v.length > 0)
          : undefined;

      const examples = [
        row.example1
          ? {
              sentence: row.example1.trim(),
              translation: row.example1Translation?.trim() || undefined,
            }
          : undefined,
        row.example2
          ? {
              sentence: row.example2.trim(),
              translation: row.example2Translation?.trim() || undefined,
            }
          : undefined,
      ].filter(
        (e): e is { sentence: string; translation: string | undefined } =>
          e !== undefined,
      );

      const plain = {
        text: (row.text || '').trim(),
        ipa: row.ipa?.trim() || undefined,
        cefrLevel: row.cefrLevel
          ? row.cefrLevel.trim().toUpperCase()
          : undefined,
        synonyms: splitMulti(row.synonyms),
        antonyms: splitMulti(row.antonyms),
        collocations: splitMulti(row.collocations),
        wordFamily: splitMulti(row.wordFamily),
        audioUrl: row.audioUrl?.trim() || undefined,
        imageUrl: row.imageUrl?.trim() || undefined,
        meanings: [
          {
            partOfSpeech: row.partOfSpeech
              ? row.partOfSpeech.trim().toUpperCase()
              : undefined,
            meaning: (row.meaning || '').trim(),
          },
        ],
        examples,
      };

      const dto = plainToInstance(CreateVocabWordDto, plain);
      const errors = validateSync(dto);
      if (errors.length > 0) {
        rowErrors.push({
          row: rowNumber,
          message: errors
            .map((e) => Object.values(e.constraints || {}).join(', '))
            .join('; '),
        });
        return;
      }

      const normalizedText = dto.text.trim().toLowerCase();
      if (seenInFile.has(normalizedText)) {
        // A later duplicate within the same file — treated as a skip
        // candidate for idempotency, not a validation error.
        return;
      }
      seenInFile.add(normalizedText);
      candidates.push({ dto, normalizedText });
    });

    if (rowErrors.length > 0) {
      throw new BadRequestException({
        message: 'CSV import failed validation',
        errors: rowErrors,
      });
    }

    const existing = await this.prismaService.vocabWord.findMany({
      select: { text: true },
    });
    const existingTexts = new Set(
      existing.map((w) => w.text.trim().toLowerCase()),
    );

    const toCreate = candidates.filter(
      (c) => !existingTexts.has(c.normalizedText),
    );
    const skippedCount = candidates.length - toCreate.length;

    if (toCreate.length === 0) {
      return { data: { createdCount: 0, skippedCount } };
    }

    // Bulk write strategy — the H2 fix. Exactly three statements in one
    // transaction (createManyAndReturn for words, then createMany for
    // meanings and createMany for examples) instead of a per-row create
    // loop, which would risk tripping Prisma's ~5s interactive-transaction
    // timeout at exactly the advertised row cap.
    await this.prismaService.$transaction(async (tx) => {
      const createdWords = await tx.vocabWord.createManyAndReturn({
        data: toCreate.map((c) => ({
          text: c.dto.text,
          ipa: c.dto.ipa,
          audioUrl: c.dto.audioUrl,
          imageUrl: c.dto.imageUrl,
          cefrLevel: c.dto.cefrLevel,
          synonyms: c.dto.synonyms ?? [],
          antonyms: c.dto.antonyms ?? [],
          collocations: c.dto.collocations ?? [],
          wordFamily: c.dto.wordFamily ?? [],
          source: WordSource.IMPORT,
        })),
      });

      // Matched back to candidates by exact text rather than by the array's
      // return order — createManyAndReturn's row order is not something to
      // depend on. Every candidate's text is unique within this batch (the
      // seenInFile/existingTexts de-dupe above guarantees it), so this join
      // is unambiguous.
      const wordIdByText = new Map(createdWords.map((w) => [w.text, w.id]));

      const meaningRows = toCreate.flatMap((c) => {
        const wordId = wordIdByText.get(c.dto.text);
        if (!wordId) return [];
        return c.dto.meanings.map((m, orderIndex) => ({
          wordId,
          partOfSpeech: m.partOfSpeech,
          meaning: m.meaning,
          orderIndex,
        }));
      });
      await tx.vocabWordMeaning.createMany({ data: meaningRows });

      const exampleRows = toCreate.flatMap((c) => {
        const wordId = wordIdByText.get(c.dto.text);
        if (!wordId || !c.dto.examples) return [];
        return c.dto.examples.map((e, orderIndex) => ({
          wordId,
          sentence: e.sentence,
          translation: e.translation,
          orderIndex,
        }));
      });
      if (exampleRows.length > 0) {
        await tx.vocabWordExample.createMany({ data: exampleRows });
      }
    });

    return { data: { createdCount: toCreate.length, skippedCount } };
  }

  private async findOneOrThrow(id: string) {
    const word = await this.prismaService.vocabWord.findUnique({
      where: { id },
    });
    if (!word) {
      throw new NotFoundException(`Vocabulary word with ID ${id} not found`);
    }
    return word;
  }
}
