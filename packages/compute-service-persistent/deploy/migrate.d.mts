export interface MigrationConfigV1 {
  readonly databaseUrlEnv: string;
  readonly migrationPath: string;
  readonly migrationSha256: string;
  readonly migrationVersion: string;
}

export interface MigrationClientV1 {
  query(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export type MigrationConnectorV1 = (connectionString: string) => Promise<MigrationClientV1>;

export function loadMigrationConfig(
  path: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<Readonly<{
  config: MigrationConfigV1;
  bytes: Uint8Array;
  connectionString: string;
}>>;

export function verifyMigration(path: string, connect?: MigrationConnectorV1): Promise<void>;
export function applyMigration(path: string, connect?: MigrationConnectorV1): Promise<void>;
