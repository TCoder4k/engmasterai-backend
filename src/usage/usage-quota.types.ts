// 2026-09-16 pricing relaunch (Phase B) — AI-cost-bearing feature quotas.
// Three real features, three kinds. "aiQuery" deliberately covers BOTH
// Dictionary lookup and Engy Chat (the product owner's own "Truy vấn AI"
// row treats them as one bucket, not two); "aiGrading" is Shadowing's AI
// pronunciation feedback; "speaking" is a Speaking Partner attempt start.
export type UsageKind = 'aiQuery' | 'aiGrading' | 'speaking';

export type UsagePeriod = 'month' | 'day';

export interface UsageQuotaConfig {
  free: number;
  pro: number;
  period: UsagePeriod;
}

// Deliberately generous — per the product owner's own explicit instruction,
// a normal learner should almost never touch the Free ceiling. These exist
// to bound worst-case AI cost from genuine abuse, not to nudge every user.
export const USAGE_QUOTA_CONFIG: Record<UsageKind, UsageQuotaConfig> = {
  aiQuery: { free: 5, pro: 300, period: 'month' },
  aiGrading: { free: 2, pro: 30, period: 'month' },
  speaking: { free: 3, pro: 30, period: 'month' },
};

export interface UsageQuotaStatus {
  kind: UsageKind;
  used: number;
  limit: number;
  period: UsagePeriod;
  // The calendar label this count is for ('YYYY-MM' or 'YYYY-MM-DD') — lets
  // the frontend show "resets in N days" without a second computation.
  periodKey: string;
}
