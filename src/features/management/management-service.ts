import type { Prisma } from "@/generated/prisma/client";
import {
  createRepairActivityInTransaction,
  updateRepairActivityInTransaction,
  type CreateRepairActivityInput,
  type UpdateRepairActivityInput,
  type RepairActivityAdminView,
} from "@/features/repair-activities/repair-activity-service";
import { operationDigest } from "@/features/management/management-input";
import { AppError } from "@/lib/api/errors";
import { requireMachineScope, type MachineActor } from "@/lib/auth/machine";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";

export type MachineActivityView = {
  id: string;
  title: string;
  /** 活动地点；历史活动为空。 */
  location: string | null;
  capacity: number;
  activityAt: string;
  /** 活动结束时间；历史活动为空。 */
  endsAt: string | null;
  signupOpensAt: string;
  signupClosesAt: string;
  version: string;
};

function view(row: Omit<MachineActivityView, "version">, version: number): MachineActivityView {
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    capacity: row.capacity,
    activityAt: row.activityAt,
    endsAt: row.endsAt,
    signupOpensAt: row.signupOpensAt,
    signupClosesAt: row.signupClosesAt,
    version: `"${version}"`,
  };
}

function replay(
  row: { requestDigest: string; result: Prisma.JsonValue },
  digest: string,
): MachineActivityView {
  if (row.requestDigest !== digest)
    throw new AppError("IDEMPOTENCY_CONFLICT", "相同操作编号的内容不同");
  return row.result as MachineActivityView;
}

async function writeOnce(
  actor: MachineActor,
  operationId: string,
  digest: string,
  work: (tx: Prisma.TransactionClient) => Promise<MachineActivityView>,
): Promise<MachineActivityView> {
  const where = { principalId_operationId: { principalId: actor.principalId, operationId } };
  try {
    return await inSerializableTransaction(async (tx) => {
      const old = await tx.botOperation.findUnique({ where });
      if (old) return replay(old, digest);
      // Unique reservation and resulting activity are committed in the SAME transaction.
      await tx.botOperation.create({
        data: {
          principalId: actor.principalId,
          operationId,
          requestDigest: digest,
          result: {},
          requestId: actor.requestId,
          requestedBy: actor.requestedBy,
          createdAt: new Date(),
        },
      });
      const result = await work(tx);
      await tx.botOperation.update({ where, data: { result } });
      return result;
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      const old = await getDb().botOperation.findUnique({ where });
      if (old) return replay(old, digest);
    }
    throw error;
  }
}

export const managementService = {
  async detail(id: string, actor: MachineActor): Promise<MachineActivityView> {
    requireMachineScope(actor, "activity:read");
    const row = await getDb().repairActivity.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new AppError("ACTIVITY_NOT_FOUND", "活动不存在");
    return view(
      {
        ...row,
        activityAt: row.activityAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
        signupOpensAt: row.signupOpensAt.toISOString(),
        signupClosesAt: row.signupClosesAt.toISOString(),
      },
      row.version,
    );
  },

  async create(
    input: CreateRepairActivityInput,
    operationId: string,
    actor: MachineActor,
  ): Promise<MachineActivityView> {
    requireMachineScope(actor, "activity:create");
    return writeOnce(
      actor,
      operationId,
      operationDigest({ action: "create", input }),
      async (tx) => {
        const result = await createRepairActivityInTransaction(tx, input, actor);
        return view(result, 1);
      },
    );
  },

  async update(
    id: string,
    input: UpdateRepairActivityInput,
    expectedVersion: number,
    operationId: string,
    actor: MachineActor,
  ): Promise<MachineActivityView> {
    requireMachineScope(actor, "activity:update");
    // Enforce narrow scope even for an internal Service caller, not only the HTTP parser.
    if (Object.keys(input).some((key) => key !== "title" && key !== "capacity")) {
      throw new AppError("FORBIDDEN", "机器接口只允许修改标题和容量");
    }
    return writeOnce(
      actor,
      operationId,
      operationDigest({ action: "update", id, input, expectedVersion }),
      async (tx) => {
        const result: RepairActivityAdminView = await updateRepairActivityInTransaction(
          tx,
          id,
          input,
          actor,
          expectedVersion,
        );
        return view(result, expectedVersion + 1);
      },
    );
  },

  async operation(operationId: string, actor: MachineActor) {
    requireMachineScope(actor, "activity:read");
    const row = await getDb().botOperation.findUnique({
      where: { principalId_operationId: { principalId: actor.principalId, operationId } },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND", "未找到已提交的操作结果，不能据此自动重试");
    const result = row.result as MachineActivityView;
    return {
      state: "succeeded" as const,
      result: { id: result.id, url: `https://pczafu.cn/repair-activities/${result.id}` },
    };
  },
};
