export interface MigrationEntryConfigV2 {
  readonly path: string;
  readonly sha256: string;
  readonly version: string;
}

export interface MigrationConfigV2 {
  readonly databaseUrlEnv: string;
  readonly migrations: readonly MigrationEntryConfigV2[];
}

export interface MigrationClientV1 {
  query(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export type MigrationConnectorV1 = (connectionString: string) => Promise<MigrationClientV1>;

export const MIGRATION_ADVISORY_LOCK_KEY: string;

export function migrationManifestSha256(
  migrations: readonly Pick<MigrationEntryConfigV2, "version" | "sha256">[],
): string;

export function loadMigrationConfig(
  sourceRoot: string,
  path: string,
  expectedConfigSha256: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<Readonly<{
  config: MigrationConfigV2;
  migrations: readonly (MigrationEntryConfigV2 & { readonly bytes: Uint8Array })[];
  migrationManifestSha256: string;
  connectionString: string;
}>>;

export function verifyMigration(
  sourceRoot: string,
  path: string,
  expectedConfigSha256: string,
  connect?: MigrationConnectorV1,
): Promise<void>;
export function applyMigration(
  sourceRoot: string,
  path: string,
  expectedConfigSha256: string,
  connect?: MigrationConnectorV1,
): Promise<void>;
