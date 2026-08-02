import postgres from "postgres";
import type { SqlExecutor } from "./storage";

export interface PostgresConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

export interface PostgresQueryClientLike {
  unsafe<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
}

export interface PostgresClientLike extends PostgresQueryClientLike {
  begin<T>(work: (transaction: PostgresQueryClientLike) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}

type PostgresTransactionRunner = <T>(work: (transaction: PostgresQueryClientLike) => Promise<T>) => Promise<T>;

export class PostgresSqlExecutor implements SqlExecutor {
  public constructor(
    private readonly client: PostgresQueryClientLike,
    private readonly transactionRunner: PostgresTransactionRunner,
    private readonly closeCallback?: () => Promise<void>,
    private readonly transactionScoped = false,
  ) {}

  public query<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]> {
    return this.client.unsafe<T>(sql, parameters);
  }

  public transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.transactionScoped) throw new Error("Nested transactions are not supported by PostgresSqlExecutor.");
    return this.transactionRunner(async (transaction) => work(new PostgresSqlExecutor(transaction, this.transactionRunner, undefined, true)));
  }

  public close(): Promise<void> {
    return this.closeCallback ? this.closeCallback() : Promise.resolve();
  }
}

function positiveNumberFromEnvironment(env: Record<string, string | undefined>, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = Number(raw.trim());
  if (raw.trim().length === 0 || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

export function postgresConfigFromEnvironment(env: Record<string, string | undefined> = Bun.env): PostgresConfig {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL configuration.");
  return {
    connectionString,
    maxConnections: positiveNumberFromEnvironment(env, "DATABASE_MAX_CONNECTIONS"),
    idleTimeoutSeconds: positiveNumberFromEnvironment(env, "DATABASE_IDLE_TIMEOUT_SECONDS"),
    connectTimeoutSeconds: positiveNumberFromEnvironment(env, "DATABASE_CONNECT_TIMEOUT_SECONDS"),
  };
}

export function createPostgresSqlExecutor(config: PostgresConfig = postgresConfigFromEnvironment()): PostgresSqlExecutor {
  const client = postgres(config.connectionString, {
    max: config.maxConnections,
    idle_timeout: config.idleTimeoutSeconds,
    connect_timeout: config.connectTimeoutSeconds,
  });
  return new PostgresSqlExecutor(
    client as unknown as PostgresClientLike,
    <T>(work: (transaction: PostgresQueryClientLike) => Promise<T>) => client.begin(async (transaction) => work(transaction)) as Promise<T>,
    () => client.end({ timeout: 5 }),
  );
}
