import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isUserPremium } from '../shared/subscription-status.util';

const TOEIC_600_LIBRARY_NAME = 'TOEIC 600 Essential Words';
const COMMON_WORDS_LIBRARY_NAME = '1000 Từ Tiếng Anh Thông Dụng';

export const isPremiumVocabularyDeck = async (
  prisma: PrismaService,
  config: ConfigService,
  deckId: string,
): Promise<boolean> => {
  const deck = await prisma.vocabDeck.findUnique({
    where: { id: deckId },
    select: { libraryId: true, library: { select: { name: true } } },
  });
  if (!deck) return false;

  if (deck.library.name === TOEIC_600_LIBRARY_NAME) return true;

  const isCommonWords = deck.library.name === COMMON_WORDS_LIBRARY_NAME;
  const grammarLibraryId = config.get<string>('PREMIUM_GRAMMAR_LIBRARY_ID');
  if (
    !isCommonWords &&
    (!grammarLibraryId || deck.libraryId !== grammarLibraryId)
  ) {
    return false;
  }

  const targetLibraryId = isCommonWords ? deck.libraryId : grammarLibraryId!;

  const firstTwo = await prisma.vocabDeck.findMany({
    where: { libraryId: targetLibraryId, isPublished: true },
    orderBy: { orderIndex: 'asc' },
    take: 2,
    select: { id: true },
  });
  return !firstTwo.some((row) => row.id === deckId);
};

export const canAccessVocabularyDeck = async (
  prisma: PrismaService,
  config: ConfigService,
  userId: string,
  deckId: string,
): Promise<boolean> => {
  return (
    (await isUserPremium(prisma, userId)) ||
    !(await isPremiumVocabularyDeck(prisma, config, deckId))
  );
};
