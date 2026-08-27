import type { RequestHandler } from 'express';
import type { Mission } from './mission.js';
import type { MissionService } from './mission-service.js';
import type { CreateMissionRequest, MissionIdParams } from './mission-schemas.js';

interface MissionResponse {
  readonly data: Mission;
}

interface MissionListResponse {
  readonly data: readonly Mission[];
}

export class MissionController {
  constructor(private readonly service: MissionService) {}

  readonly create: RequestHandler<never, MissionResponse, CreateMissionRequest> = async (
    request,
    response,
  ) => {
    const mission = await this.service.create(request.body);
    response.status(201).json({ data: mission });
  };

  readonly list: RequestHandler<never, MissionListResponse> = async (_request, response) => {
    const missions = await this.service.list();
    response.status(200).json({ data: missions });
  };

  readonly get: RequestHandler<MissionIdParams, MissionResponse> = async (request, response) => {
    const mission = await this.service.get(request.params.id);
    response.status(200).json({ data: mission });
  };

  readonly cancel: RequestHandler<MissionIdParams, MissionResponse> = async (request, response) => {
    const mission = await this.service.cancel(request.params.id);
    response.status(200).json({ data: mission });
  };
}
