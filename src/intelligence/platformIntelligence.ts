/**
 * platformIntelligence.ts — which platforms are actually worth posting to.
 *
 * The system posts to 30+ platforms on a fixed schedule. Nobody currently
 * knows which of them produce anything. This module answers that from the
 * collected data, per platform, over a window:
 *
 *   posts        — how many we published
 *   indexed      — how many are in Google's index (evidence-based, tri-state)
 *   sessions     — GA4 traffic attributed to that platform via utm_source
 *   leads        — CRM leads attributed to that platform
 *   per-post     — the ratios that make platforms comparable
 *
 * Deliberate restraint: this module RECOMMENDS, it never changes the schedule.
 * Dropping a platform is a human decision, and the data behind it must be
 * legible enough to argue with.
 */

import type { DB } from './db.js';
import { nowIso, daysAgo, isoDate } from './db.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from './weights.js';
import { PLATFORMS, platformByName, type PlatformInfo } from './platforms.js';
import { enabled } from './flags.js';
import { normaliseUrl } from './indexation.js';

export interface PlatformWindowStats {
  platform: string;
  windowStart: string;
  windowEnd: string;
  posts: number;
  postsIndexed: number;
  postsNotIndexed: number;
  postsUnknown: number;
  sessions: number;
  clicks: number;
  impressions: number;
  leads: number;
  /** Share of posts with positive indexation evidence. Excludes unknowns. */
  indexationRate: number | null;
  sessionsPerPost: number | null;
  leadsPerPost: number | null;
  /** How much of the picture we actually have, 0..1. */
  dataCoverage: number;
}

export type Recommendation = 'keep' | 'investigate' | 'consider-dropping' | 'insufficient-data';

export interface PlatformVerdict {
  platform: string;
  stats: PlatformWindowStats;
  recommendation: Recommendation;
  reasons: string[];
  /** Never silently acted on. Always requires a human. */
  confidence: 'low' | 'medium' | 'high';
}

export interface ComputeOptions {
  db: DB;
  windowDays?: number;
  endDate?: string;
  thresholds?: Thresholds;
}

/**
 * Indexation rate deliberately EXCLUDES unknowns from the denominator.
 * Counting an unknown as "not indexed" would make a flaky SERP provider look
 * like a failing platform.
 */
/**
 * Every spelling of a platform that might appear in published_posts.platform.
 * The sheet, the posting agents and the UTM table do not agree on one form, so
 * matching on a single field silently loses whole platforms.
 */
export function platformAliases(p: PlatformInfo): string[] {
  return [...new Set([p.key, p.name, p.utmSource].map(v => String(v).toLowerCase()))];
}

export function indexationRate(indexed: number, notIndexed: number): number | null {
  const known = indexed + notIndexed;
  return known === 0 ? null : indexed / known;
}

export function computePlatformStats(opts: ComputeOptions): PlatformWindowStats[] {
  const { db } = opts;
  const windowDays = opts.windowDays ?? 90;
  const windowEnd = opts.endDate ?? isoDate();
  const windowStart = daysAgo(windowDays, new Date(`${windowEnd}T00:00:00Z`));

  const out: PlatformWindowStats[] = [];

  for (const p of PLATFORMS) {
    // Match key, display name AND utmSource. The ingest normalises a sheet
    // value like "Google Sites" to "googlesites", which is the utmSource form
    // and matches neither the key ("googlesite") nor the name ("GoogleSite").
    // Without this, 44 Google Sites posts and 17 4shared posts read as zero and
    // both platforms reported "insufficient-data" while being actively used.
    const aliases = platformAliases(p);
    const posts = db.prepare(
      `SELECT COUNT(*) AS c FROM published_posts
        WHERE LOWER(platform) IN (${aliases.map(() => '?').join(',')})
          AND posted_at >= ? AND posted_at <= ?`
    ).get(...aliases, windowStart, `${windowEnd}T23:59:59Z`) as any;

    // indexation_checks stores the NORMALISED url (scheme/www/utm/trailing
    // slash stripped) while published_posts stores the raw url from the sheet.
    // A SQL join on equality therefore matches nothing — it silently reported
    // zero indexation for every platform forever. Normalise in JS and look the
    // checks up by key instead.
    const postUrls = (db.prepare(
      `SELECT published_url FROM published_posts
        WHERE LOWER(platform) IN (${aliases.map(() => '?').join(',')})
          AND posted_at >= ? AND published_url IS NOT NULL`
    ).all(...aliases, windowStart) as any[])
      .map(r => normaliseUrl(String(r.published_url)))
      .filter(Boolean);

    const idx = { indexed: 0, notIndexed: 0, unknown: 0 };
    if (postUrls.length) {
      const latest = db.prepare(
        `SELECT status FROM indexation_checks
          WHERE url = ? ORDER BY checked_at DESC LIMIT 1`
      );
      for (const u of postUrls) {
        const row = latest.get(u) as any;
        if (!row) continue;
        if (row.status === 'indexed') idx.indexed++;
        else if (row.status === 'not_indexed') idx.notIndexed++;
        else idx.unknown++;
      }
    }

    // GA4 attributes traffic by utm_source, which the posting code already sets
    // on every outbound link (see src/utils/utm.ts).
    //
    // Storage convention comes from collectors/ga4.ts and MUST be matched
    // exactly: platform rows use metric_scope='utm_source' and pack the
    // dimension as '<sessionSource>|<sessionCampaign>'. Matching the source
    // part therefore needs a prefix comparison, not equality — an earlier
    // equality match silently returned zero sessions for every platform,
    // which would have made the whole estate look dead.
    const traffic = db.prepare(
      `SELECT SUM(sessions) AS sessions, SUM(clicks) AS clicks, SUM(impressions) AS impressions
         FROM url_performance
        WHERE metric_scope = 'utm_source'
          AND (LOWER(dimension_value) = ? OR LOWER(dimension_value) LIKE ? )
          AND metric_date >= ? AND metric_date <= ?`
    ).get(
      p.utmSource.toLowerCase(),
      `${p.utmSource.toLowerCase()}|%`,
      windowStart, windowEnd,
    ) as any;

    const leadRow = db.prepare(
      `SELECT COUNT(*) AS c FROM leads
        WHERE LOWER(utm_source) = ? AND created_at >= ?`
    ).get(p.utmSource.toLowerCase(), windowStart) as any;

    const postCount = Number(posts?.c ?? 0);
    const indexed = Number(idx?.indexed ?? 0);
    const notIndexed = Number(idx?.notIndexed ?? 0);
    const unknown = Number(idx?.unknown ?? 0);
    const sessions = Number(traffic?.sessions ?? 0);
    const leads = Number(leadRow?.c ?? 0);

    const haveIndexation = indexed + notIndexed + unknown > 0;
    const haveTraffic = traffic && traffic.sessions !== null && traffic.sessions !== undefined;
    const haveLeads = hasAnyLeads(db);
    const coverage = [postCount > 0, haveIndexation, haveTraffic, haveLeads]
      .filter(Boolean).length / 4;

    out.push({
      platform: p.name,
      windowStart, windowEnd,
      posts: postCount,
      postsIndexed: indexed,
      postsNotIndexed: notIndexed,
      postsUnknown: unknown,
      sessions,
      clicks: Number(traffic?.clicks ?? 0),
      impressions: Number(traffic?.impressions ?? 0),
      leads,
      indexationRate: indexationRate(indexed, notIndexed),
      sessionsPerPost: postCount > 0 && haveTraffic ? sessions / postCount : null,
      leadsPerPost: postCount > 0 && haveLeads ? leads / postCount : null,
      dataCoverage: coverage,
    });
  }

  return out;
}

function hasAnyLeads(db: DB): boolean {
  const r = db.prepare('SELECT COUNT(*) AS c FROM leads').get() as any;
  return Number(r?.c ?? 0) > 0;
}

/**
 * Turn stats into a recommendation.
 *
 * The bar for "consider dropping" is deliberately high: a sufficient sample,
 * real traffic data, AND genuinely poor output. Absence of data is reported as
 * absence of data — never as failure.
 */
export function recommend(
  s: PlatformWindowStats,
  t: Thresholds = DEFAULT_THRESHOLDS,
): PlatformVerdict {
  const reasons: string[] = [];

  if (s.posts < t.platformMinimumSample) {
    reasons.push(`only ${s.posts} posts in window (need ${t.platformMinimumSample} to judge)`);
    return { platform: s.platform, stats: s, recommendation: 'insufficient-data', reasons, confidence: 'low' };
  }

  if (s.sessionsPerPost === null && s.leadsPerPost === null) {
    reasons.push('no traffic or lead data collected yet — cannot assess value');
    return { platform: s.platform, stats: s, recommendation: 'insufficient-data', reasons, confidence: 'low' };
  }

  const poorTraffic = s.sessionsPerPost !== null && s.sessionsPerPost < t.platformSessionsPerPostFloor;
  const noLeads = s.leadsPerPost !== null && s.leadsPerPost === 0;
  const poorIndexation = s.indexationRate !== null && s.indexationRate < 0.25;

  if (s.leadsPerPost !== null && s.leadsPerPost > 0) {
    reasons.push(`produces leads (${s.leads} from ${s.posts} posts)`);
    return { platform: s.platform, stats: s, recommendation: 'keep', reasons, confidence: 'high' };
  }

  if (poorTraffic && noLeads) {
    reasons.push(`${s.sessionsPerPost!.toFixed(2)} sessions/post (floor ${t.platformSessionsPerPostFloor})`);
    reasons.push('zero attributed leads');
    if (poorIndexation) reasons.push(`only ${(s.indexationRate! * 100).toFixed(0)}% of posts show indexation evidence`);
    const confidence = s.dataCoverage >= 0.75 ? 'high' : 'medium';
    return { platform: s.platform, stats: s, recommendation: 'consider-dropping', reasons, confidence };
  }

  if (poorIndexation) {
    reasons.push(`low indexation evidence (${(s.indexationRate! * 100).toFixed(0)}%) — posts may not be visible to search`);
    return { platform: s.platform, stats: s, recommendation: 'investigate', reasons, confidence: 'medium' };
  }

  if (poorTraffic) {
    reasons.push(`low traffic (${s.sessionsPerPost!.toFixed(2)} sessions/post) but lead data is inconclusive`);
    return { platform: s.platform, stats: s, recommendation: 'investigate', reasons, confidence: 'medium' };
  }

  reasons.push(`${s.sessionsPerPost?.toFixed(2) ?? '?'} sessions/post`);
  return { platform: s.platform, stats: s, recommendation: 'keep', reasons, confidence: s.dataCoverage >= 0.75 ? 'high' : 'medium' };
}

export function persistPlatformStats(db: DB, stats: PlatformWindowStats[]): number {
  let n = 0;
  for (const s of stats) {
    db.prepare(
      `INSERT INTO platform_stats
         (platform, window_start, window_end, posts, posts_indexed, posts_unknown,
          sessions, clicks, impressions, leads, success_rate, sessions_per_post,
          leads_per_post, computed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(platform, window_start, window_end) DO UPDATE SET
         posts=excluded.posts, posts_indexed=excluded.posts_indexed,
         posts_unknown=excluded.posts_unknown, sessions=excluded.sessions,
         clicks=excluded.clicks, impressions=excluded.impressions,
         leads=excluded.leads, success_rate=excluded.success_rate,
         sessions_per_post=excluded.sessions_per_post,
         leads_per_post=excluded.leads_per_post, computed_at=excluded.computed_at`
    ).run(
      s.platform, s.windowStart, s.windowEnd, s.posts, s.postsIndexed, s.postsUnknown,
      s.sessions, s.clicks, s.impressions, s.leads, s.indexationRate,
      s.sessionsPerPost, s.leadsPerPost, nowIso(),
    );
    n++;
  }
  return n;
}

export function analysePlatforms(opts: ComputeOptions): PlatformVerdict[] {
  if (!enabled('PLATFORM_INTELLIGENCE')) return [];
  const stats = computePlatformStats(opts);
  persistPlatformStats(opts.db, stats);
  return stats
    .map(s => recommend(s, opts.thresholds))
    .sort((a, b) => (b.stats.sessionsPerPost ?? -1) - (a.stats.sessionsPerPost ?? -1));
}

/** Human-readable table for the CLI report. */
export function formatPlatformReport(verdicts: PlatformVerdict[]): string {
  if (!verdicts.length) return 'No platform data. Is FEATURE_PLATFORM_INTELLIGENCE enabled, and has any data been collected?';

  const rows = verdicts.map(v => ({
    platform: v.platform,
    posts: String(v.stats.posts),
    idx: v.stats.indexationRate === null ? '—' : `${(v.stats.indexationRate * 100).toFixed(0)}%`,
    spp: v.stats.sessionsPerPost === null ? '—' : v.stats.sessionsPerPost.toFixed(2),
    leads: v.stats.leadsPerPost === null ? '—' : String(v.stats.leads),
    rec: v.recommendation,
  }));

  const w = (k: keyof typeof rows[0], min: number) =>
    Math.max(min, ...rows.map(r => r[k].length));
  const wp = w('platform', 8), wr = w('rec', 14);

  const lines = [
    `${'PLATFORM'.padEnd(wp)}  ${'POSTS'.padStart(5)}  ${'INDEX'.padStart(5)}  ${'SESS/POST'.padStart(9)}  ${'LEADS'.padStart(5)}  RECOMMENDATION`,
    `${'-'.repeat(wp)}  ${'-'.repeat(5)}  ${'-'.repeat(5)}  ${'-'.repeat(9)}  ${'-'.repeat(5)}  ${'-'.repeat(wr)}`,
  ];
  for (const r of rows) {
    lines.push(`${r.platform.padEnd(wp)}  ${r.posts.padStart(5)}  ${r.idx.padStart(5)}  ${r.spp.padStart(9)}  ${r.leads.padStart(5)}  ${r.rec}`);
  }
  lines.push('');
  lines.push('"—" means not measured. Recommendations are advisory; the schedule is never changed automatically.');
  return lines.join('\n');
}
