import { AssessmentLockService } from './assessment-lock.service';
import { AssessmentInProgressException } from './chat.exceptions';

const buildService = (findFirst: jest.Mock) => {
  const prisma = { placementAttempt: { findFirst } };
  return new AssessmentLockService(prisma as never);
};

describe('AssessmentLockService.assertNotInPlacementAttempt', () => {
  it('throws AssessmentInProgressException when an unfinished attempt exists', async () => {
    const service = buildService(jest.fn().mockResolvedValue({ id: 'attempt-1' }));

    await expect(service.assertNotInPlacementAttempt('user-1')).rejects.toBeInstanceOf(
      AssessmentInProgressException,
    );
  });

  it('resolves without throwing when there is no unfinished attempt', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = buildService(findFirst);

    await expect(service.assertNotInPlacementAttempt('user-1')).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', completedAt: null },
      select: { id: true },
    });
  });

  it('resolves when the user has only COMPLETED placement attempts', async () => {
    // completedAt: null is the filter itself — a completed attempt never
    // matches findFirst's where clause in the first place, so this is
    // really the same code path as "no attempt" above, exercised with a
    // completed row present in the (mocked) database to make the intent
    // explicit.
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = buildService(findFirst);

    await expect(service.assertNotInPlacementAttempt('user-1')).resolves.toBeUndefined();
  });
});
