import {
  LearningGoal,
  PaymentStatus,
  SubscriptionPlan,
  UserRole,
} from '@prisma/client';

// Sprint 15 — Admin student management.
//
// progressPercent/completedLessons/totalLessons deliberately reuse the SAME
// definition the student's own dashboard (UserHome.tsx) shows them: the sum
// of totalLessons/completedLessons across the COURSE-type items in THIS
// student's own roadmap (GrammarRoadmap pillar only — VocabLibrary/Listening/
// Speaking roadmap items are not lesson-based and are intentionally excluded,
// same as the frontend today). There is no other "overall progress" concept
// anywhere in this codebase (confirmed before implementing — see
// docs/memory.md), so this is a reuse, not a new metric. A student who has
// not yet generated a roadmap (no placement test taken) has no percentage —
// `hasRoadmap: false`, not a fabricated 0%.
export interface RoadmapProgress {
  progressPercent: number | null;
  completedLessons: number;
  totalLessons: number;
  hasRoadmap: boolean;
}

// Lifetime average of LessonTaskAttempt.accuracyPercent across every
// published QUIZ/PRACTICE attempt this student has ever submitted — the same
// field and the same account-wide publishedTask scope
// DashboardAnalyticsService.recentAccuracyPercent already uses, just not
// bounded to the last 20 (that bound exists there to keep one specific
// dashboard widget responsive to a recent study session; an admin reviewing
// a student's overall performance wants the full history). No Dictation/
// Shadowing rows are mixed in — their accuracyPercent has different scoring
// semantics (see docs/memory.md) and merging them would be inventing a new
// metric, not reusing an existing one.
export interface AverageTestScore {
  averageTestScore: number | null;
  completedTestCount: number;
}

export interface AdminStudentListRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: UserRole;
  level: number;
  learningGoal: LearningGoal | null;
  progressPercent: number | null;
  completedLessons: number;
  totalLessons: number;
  averageTestScore: number | null;
  completedTestCount: number;
  isPro: boolean;
  proExpiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface AdminStudentListResult {
  data: AdminStudentListRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface AdminStudentRecentTest {
  taskTitle: string;
  lessonTitle: string;
  accuracyPercent: number;
  correctCount: number;
  totalCount: number;
  // Straight from LessonTaskAttempt.passed — no invented pass/fail threshold.
  passed: boolean;
  submittedAt: Date;
}

export interface AdminStudentPaymentRow {
  paymentCode: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
  paidAt: Date | null;
}

export interface AdminStudentDetail {
  profile: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    level: number;
    learningGoal: LearningGoal | null;
    createdAt: Date;
    isActive: boolean;
    isPro: boolean;
    proExpiresAt: Date | null;
  };
  progress: RoadmapProgress &
    AverageTestScore & { recentTests: AdminStudentRecentTest[] };
  activity: {
    totalStudySeconds: number;
    currentStreakDays: number;
    speakingSessionsTotal: number;
    speakingSessionsCompleted: number;
  };
  billing: {
    plan: SubscriptionPlan | null;
    isPro: boolean;
    proExpiresAt: Date | null;
    payments: AdminStudentPaymentRow[];
    paymentsTotal: number;
  };
}
