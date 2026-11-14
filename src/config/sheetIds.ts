/**
 * sheetIds.ts — single source of truth for every Google Spreadsheet ID.
 *
 * MILESTONE 0 (safety harness). Purpose: make it impossible to point a
 * development run at the production spreadsheets by accident.
 *
 * Design contract:
 *   - With NO environment configured, every exported id is byte-identical to
 *     the literal that was previously hardcoded. Production behaviour is
 *     therefore unchanged by this file's introduction.
 *   - KEN_ENV is strictly validated. Only 'development' and 'production' are
 *     accepted; anything else throws. A typo such as KEN_ENV=dev must never
 *     silently degrade into a production run.
 *   - In development mode there is NO fallback to production. If a dev id is
 *     missing, blank, or still equal to a production id, startup fails loudly.
 *
 * To run against a development spreadsheet:
 *   KEN_ENV=development
 *   MAIN_SHEET_ID=<your dev spreadsheet id>
 *   DISTRIBUTED_URL_SHEET_ID=<your dev spreadsheet id>
 */

/** The live production spreadsheets. Defaults, so an unset env == today. */
const PROD_MAIN_SHEET_ID = '1p_N3zzJbUx-7t8sjuAtbQsHaUfVmYxytQU_gDd2MGwQ';
const PROD_DISTRIBUTED_URL_SHEET_ID = '1ZbEcDaK-zb6U1SK1P23UIjezN5NGdy3R15r9W-glVlU';

/** Every production id, for the "is this a production id?" check. */
const ALL_PRODUCTION_IDS: readonly string[] = [
  PROD_MAIN_SHEET_ID,
  PROD_DISTRIBUTED_URL_SHEET_ID,
];

export type KenEnv = 'development' | 'production';

/**
 * Strict KEN_ENV parsing. Unset => 'production' (preserves today's
 * behaviour). Any value other than the two valid ones throws rather than
 * being coerced, so a misspelling can never be read as "production".
 */
export function parseKenEnv(raw: string | undefined): KenEnv {
  if (raw === undefined || raw.trim() === '') return 'production';
  const v = raw.trim();
  if (v === 'development' || v === 'production') return v;
  throw new Error(
    `[sheetIds] Invalid KEN_ENV value ${JSON.stringify(raw)}. ` +
    `Only "development" or "production" are accepted (case-sensitive). ` +
    `Refusing to start rather than guessing which environment you meant.`
  );
}

export const KEN_ENV: KenEnv = parseKenEnv(process.env.KEN_ENV);
export const IS_DEVELOPMENT = KEN_ENV === 'development';

export function isProductionId(id: string): boolean {
  return ALL_PRODUCTION_IDS.includes(id);
}

/**
 * Resolve one spreadsheet id.
 *
 * production: env override if present, else the production default.
 * development: env override is MANDATORY and must not be a production id.
 */
export function resolveSheetId(
  envName: string,
  productionDefault: string,
  env: NodeJS.ProcessEnv = process.env,
  kenEnv: KenEnv = KEN_ENV,
): string {
  const override = env[envName]?.trim();

  if (kenEnv === 'development') {
    if (!override) {
      throw new Error(
        `[sheetIds] KEN_ENV=development but ${envName} is not set. ` +
        `Development mode never falls back to the production spreadsheet. ` +
        `Set ${envName} to your development spreadsheet id.`
      );
    }
    if (isProductionId(override)) {
      throw new Error(
        `[sheetIds] KEN_ENV=development but ${envName} resolves to a PRODUCTION ` +
        `spreadsheet id. Refusing to start — a development run must never read ` +
        `or write production data. Set ${envName} to your development spreadsheet id.`
      );
    }
    return override;
  }

  return override || productionDefault;
}

export const MAIN_SHEET_ID = resolveSheetId('MAIN_SHEET_ID', PROD_MAIN_SHEET_ID);
export const DISTRIBUTED_URL_SHEET_ID = resolveSheetId(
  'DISTRIBUTED_URL_SHEET_ID',
  PROD_DISTRIBUTED_URL_SHEET_ID,
);

/** Mask an id for logs — never print a full spreadsheet id to a shared log. */
export function maskId(id: string): string {
  if (id.length <= 12) return '***';
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function describeSheetConfig(): string {
  return `env=${KEN_ENV} main=${maskId(MAIN_SHEET_ID)} distributedUrl=${maskId(DISTRIBUTED_URL_SHEET_ID)}`;
}
