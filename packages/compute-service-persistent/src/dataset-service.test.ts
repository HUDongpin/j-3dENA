import { describe, expect, it } from "vitest";

import {
  InMemoryComputeObjectStore,
  ManualComputeClock,
} from "@3dena/compute-service-core";
import {
  HmacComputeHttpCapabilityCodec,
} from "@3dena/compute-service-http";
import { createBrowserPreflightReceipt } from "@3dena/dataset-workflow";

import { PostgresComputeHttpDatasetWorkflowService } from "./dataset-service";
import {
  PostgresDatabase,
  type PgCompatibleClient,
  type PgCompatiblePool,
  type SqlQueryResult,
} from "./postgres";

const NOW = Date.parse("2026-08-21T00:00:00.000Z");

class DatasetPool implements PgCompatiblePool, PgCompatibleClient {
  readonly statements: string[] = [];
  workflow: {
    generation: number;
    revision: number;
    session: unknown;
    control_state: unknown;
    active_record: unknown | null;
    deleted: boolean;
  } | undefined;
  readonly artifacts = new Map<string, unknown>();

  async connect(): Promise<PgCompatibleClient> { return this; }
  release(): void {}
  async query<Row extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO compute_dataset_workflows")) {
      if (this.workflow !== undefined) return { rows: [], rowCount: 0 };
      this.workflow = {
        generation: Number(values[1]),
        revision: 0,
        session: JSON.parse(String(values[2])),
        control_state: JSON.parse(String(values[3])),
        active_record: null,
        deleted: false,
      };
      return { rows: [{ ...this.workflow }] as unknown as Row[], rowCount: 1 };
    }
    if (sql.includes("SELECT revision, session, control_state")) {
      const target = this.workflow;
      return {
        rows: (target === undefined || target.deleted ? [] : [{ ...target }]) as unknown as Row[],
        rowCount: target === undefined || target.deleted ? 0 : 1,
      };
    }
    if (sql.includes("SELECT generation, active_record") && sql.includes("FOR UPDATE")) {
      const target = this.workflow;
      return {
        rows: (target === undefined || target.deleted ? [] : [{
          generation: target.generation,
          active_record: target.active_record,
        }]) as unknown as Row[],
        rowCount: target === undefined || target.deleted ? 0 : 1,
      };
    }
    if (sql.includes("SET generation = $2")) {
      this.workflow!.generation = Number(values[1]);
      this.workflow!.revision += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT generation FROM compute_dataset_workflows")) {
      return {
        rows: [{ generation: this.workflow!.generation }] as unknown as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO compute_dataset_artifacts")) {
      // SQL embeds artifact kind, so values are datasetId, identity, JSON.
      const identity = String(values[1]);
      const kind = sql.includes("'upload'") ? "upload" : "parsed";
      const artifactKey = `${kind}:${identity}`;
      if (this.artifacts.has(artifactKey)) return { rows: [], rowCount: 0 };
      this.artifacts.set(artifactKey, JSON.parse(String(values[2])));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("artifact_kind = 'parsed'")) {
      const rows = [...this.artifacts.entries()]
        .filter(([key]) => key.startsWith("parsed:"))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, record]) => ({ record }));
      return { rows: rows as unknown as Row[], rowCount: rows.length };
    }
    if (sql.includes("SELECT record FROM compute_dataset_artifacts")) {
      const record = this.artifacts.get(`${String(values[1])}:${String(values[2])}`);
      return {
        rows: (record === undefined ? [] : [{ record }]) as unknown as Row[],
        rowCount: record === undefined ? 0 : 1,
      };
    }
    if (sql.includes("SET revision = revision + 1, control_state")) {
      if (this.workflow!.revision !== Number(values[1])) return { rows: [], rowCount: 0 };
      this.workflow!.revision += 1;
      this.workflow!.control_state = JSON.parse(String(values[2]));
      return { rows: [{ revision: this.workflow!.revision }] as unknown as Row[], rowCount: 1 };
    }
    if (sql.includes("SET active_record = $2")) {
      this.workflow!.active_record = JSON.parse(String(values[1]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT active_record FROM compute_dataset_workflows")) {
      return {
        rows: [{ active_record: this.workflow!.active_record }] as unknown as Row[],
        rowCount: 1,
      };
    }
    if (sql.startsWith("DELETE FROM compute_dataset_artifacts")) {
      this.artifacts.clear();
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET deleted_at = clock_timestamp")) {
      this.workflow!.deleted = true;
      this.workflow!.control_state = {};
      this.workflow!.active_record = null;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO compute_dataset_deletion_receipts")) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe("PostgresComputeHttpDatasetWorkflowService", () => {
  it("recovers inventory/mapping/activation across service restart and deletes sensitive state", async () => {
    const bytes = new TextEncoder().encode(
      "participant,group,conversation,A,B,C\n" +
      "p1,g1,c1,1,0,1\n" +
      "p2,g2,c2,0,1,1\n",
    );
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes,
    });
    const pool = new DatasetPool();
    const database = new PostgresDatabase(pool);
    const store = new InMemoryComputeObjectStore();
    const clock = new ManualComputeClock(NOW);
    const codec = new HmacComputeHttpCapabilityCodec("persistent-dataset-test-secret-at-least-32-bytes");
    const token = codec.issue("dataset-restart-1");
    const first = new PostgresComputeHttpDatasetWorkflowService({
      database, objectStore: store, capabilityCodec: codec, clock,
    });
    const session = await first.create({
      datasetId: "dataset-restart-1",
      capabilityHash: codec.hashSecret(token),
      boundOrigin: "https://app.example",
      request: {
        schemaVersion: "3dena.create-compute-dataset-request.v1",
        preflight,
        processingPolicyConfirmed: true,
      },
      createdAtMs: NOW,
      expiresAtMs: NOW + 60_000,
    });
    await first.uploadContent(session, bytes);

    const restarted = new PostgresComputeHttpDatasetWorkflowService({
      database, objectStore: store, capabilityCodec: codec, clock,
    });
    await expect(restarted.authorize(
      session.datasetId,
      token,
      "https://app.example",
    )).resolves.toMatchObject({ datasetId: session.datasetId });
    const parsed = await restarted.selectWorksheet(session, {
      schemaVersion: "3dena.select-compute-dataset-worksheet-request.v1",
      selection: null,
    });
    const mapping = await restarted.putMapping(session, {
      schemaVersion: "3dena.put-compute-dataset-mapping-request.v1",
      parsedIdentity: parsed.parsedIdentity,
      mapping: {
        schemaVersion: "3dena.dataset-role-mapping.v1",
        columns: parsed.headers.map((header, index) => ({
          index,
          header,
          roles: header === "participant" ? ["unit"] :
            header === "group" ? ["unit", "group"] :
            header === "conversation" ? ["conversation"] : ["code"],
        })),
      },
    });
    const preview = await restarted.preview(session, {
      schemaVersion: "3dena.preview-compute-dataset-request.v1",
      mappingSha256: mapping.mappingSha256,
    });
    const activation = await restarted.activate(session, {
      schemaVersion: "3dena.activate-compute-dataset-request.v1",
      activationIdentity: preview.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    expect(store.keys()).toEqual(expect.arrayContaining([
      session.inputObjectKey,
      expect.stringMatching(/^compute-datasets\/dataset-restart-1\/parsed\/[a-f0-9]{64}\.json$/u),
    ]));
    expect(JSON.stringify(pool.workflow?.control_state)).not.toContain("\"p1\"");

    const restartedAgain = new PostgresComputeHttpDatasetWorkflowService({
      database, objectStore: store, capabilityCodec: codec, clock,
    });
    await expect(restartedAgain.resolveActivatedExecution(
      session.datasetId,
      activation.activationReceiptSha256,
    )).resolves.toMatchObject({
      receipt: { activationReceiptSha256: activation.activationReceiptSha256 },
      payload: { rows: expect.any(Array) },
    });
    await restartedAgain.deleteActivated(session.datasetId, activation.activationReceiptSha256);
    expect(pool.artifacts.size).toBe(0);
    expect(store.keys()).toEqual([]);
    await expect(restartedAgain.resolveActivatedExecution(
      session.datasetId,
      activation.activationReceiptSha256,
    )).resolves.toBeNull();
    expect(pool.statements.join("\n")).toContain("FOR UPDATE");
    expect(pool.statements.join("\n")).toContain("clock_timestamp()");
  });
});
