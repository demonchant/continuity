import { Prisma, type PrismaClient, type VirtualsJob as PrismaVirtualsJob } from '@prisma/client';
import type { JsonObject } from '../../missions/mission.js';
import type { AcpEvidenceProvenance } from '../../verification/evidence-hash.js';
import type { VirtualsJobRepository } from './virtuals-job-repository.js';
import type {
  CreateVirtualsJobInput,
  UpdateVirtualsJobInput,
  VirtualsJob,
} from './virtuals-job.js';

function jsonObject(value: Prisma.JsonValue, label: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`Virtuals ${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function toDomain(record: PrismaVirtualsJob): VirtualsJob {
  const result = record.result ? jsonObject(record.result, 'result') : undefined;
  const verification = record.verification
    ? jsonObject(record.verification, 'verification')
    : undefined;
  const lifecycle = record.lifecycle ? jsonObject(record.lifecycle, 'lifecycle') : undefined;
  const provenance = record.provenance ? jsonObject(record.provenance, 'provenance') : undefined;
  return {
    id: record.id,
    missionId: record.missionId,
    actionId: record.actionId,
    externalJobId: record.externalJobId,
    chainId: record.chainId,
    agentId: record.agentId,
    providerAddress: record.providerAddress,
    offeringName: record.offeringName,
    state: record.state,
    requirement: jsonObject(record.requirement, 'requirement'),
    ...(result ? { result } : {}),
    ...(verification ? { verification } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(record.evidenceHash ? { evidenceHash: record.evidenceHash } : {}),
    ...(provenance ? { provenance: provenance as AcpEvidenceProvenance } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
  };
}

export class PrismaVirtualsJobRepository implements VirtualsJobRepository {
  constructor(private readonly client: PrismaClient) {}

  async createOrGet(input: CreateVirtualsJobInput): Promise<VirtualsJob> {
    const existing = await this.client.virtualsJob.findUnique({
      where: { missionId_actionId: { missionId: input.missionId, actionId: input.actionId } },
    });
    if (existing) return toDomain(existing);
    try {
      return toDomain(
        await this.client.virtualsJob.create({
          data: {
            ...input,
            requirement: input.requirement,
          },
        }),
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced = await this.client.virtualsJob.findUnique({
        where: { missionId_actionId: { missionId: input.missionId, actionId: input.actionId } },
      });
      if (!raced) throw error;
      return toDomain(raced);
    }
  }

  findById(id: string): Promise<VirtualsJob | null> {
    return this.client.virtualsJob
      .findUnique({ where: { id } })
      .then((record) => (record ? toDomain(record) : null));
  }

  findByMissionId(missionId: string): Promise<readonly VirtualsJob[]> {
    return this.client.virtualsJob
      .findMany({ where: { missionId }, orderBy: { createdAt: 'asc' } })
      .then((records) => records.map(toDomain));
  }

  findByMissionAndAction(missionId: string, actionId: string): Promise<VirtualsJob | null> {
    return this.client.virtualsJob
      .findUnique({ where: { missionId_actionId: { missionId, actionId } } })
      .then((record) => (record ? toDomain(record) : null));
  }

  async update(input: UpdateVirtualsJobInput): Promise<VirtualsJob> {
    const terminal = ['COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(input.state);
    const record = await this.client.virtualsJob.update({
      where: { id: input.id },
      data: {
        state: input.state,
        ...(input.result ? { result: input.result } : {}),
        ...(input.verification ? { verification: input.verification } : {}),
        ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
        ...(input.evidenceHash ? { evidenceHash: input.evidenceHash } : {}),
        ...(input.provenance ? { provenance: input.provenance } : {}),
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        ...(terminal ? { completedAt: new Date() } : {}),
      },
    });
    return toDomain(record);
  }
}
