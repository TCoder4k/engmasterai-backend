// Sprint 10.5 — POST /study-time/heartbeat's response.
//
// ONE FIELD, DELIBERATELY.
//
// An earlier draft also returned `todayActiveSeconds` so the sidebar could
// update without refetching. It was removed before implementation: the widget
// reads GET /analytics/dashboard, and returning the same figure from the WRITE
// path would create a second state-sync route for a number that changes once a
// minute. Sprint 10's QA bug 2 was exactly that class of defect — a client-side
// fold racing a server read — and it cost a DTO change to fix. The dashboard
// endpoint is the only read source for study minutes.
//
// `acceptedSeconds` exists for diagnosis, not for display: it is how a client
// (or an operator reading a HAR file) can tell "credited" from "replayed" and
// from "clamped by the daily ceiling", all of which are 200s.
export interface StudyHeartbeatResponseDto {
  /**
   * Seconds actually written to the ledger by THIS call.
   *
   * 0 has three legitimate causes, and none of them is an error: the heartbeat
   * was a replay of one already recorded, the day's convergence cap is already
   * spent, or the clock reports no elapsed time to credit.
   */
  acceptedSeconds: number;
}
