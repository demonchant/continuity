import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { serializeBaseTransaction } from '../integrations/base/base-routes.js';
import type { MissionService } from '../missions/mission-service.js';
import { AppError } from '../shared/errors/app-error.js';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateBody } from '../shared/http/validation.js';
import type { EconomicActionService } from './economic-action-service.js';

const requestSchema = z
  .object({
    missionId: z.string().uuid(),
    capabilities: z.array(z.string().trim().min(1)).min(1).max(20),
    budgetCurrency: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .transform((value) => value.toUpperCase()),
    candidateLimit: z.number().int().min(1).max(20).optional(),
    executeBase: z.boolean().default(false),
    actionId: z.string().trim().min(1).max(200),
    paymentId: z.string().trim().min(1).max(200),
  })
  .strict();

function authenticated(expected: string): RequestHandler {
  return (request, _response, next) => {
    const authorization = request.header('authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      next(
        new AppError({
          statusCode: 401,
          code: 'ECONOMIC_UNAUTHORIZED',
          message: 'A valid operator token is required',
        }),
      );
      return;
    }
    next();
  };
}

function serialized(result: Awaited<ReturnType<EconomicActionService['execute']>>) {
  return result.baseAction.status === 'CONFIRMED'
    ? {
        ...result,
        baseAction: {
          ...result.baseAction,
          transaction: serializeBaseTransaction(result.baseAction.transaction),
        },
      }
    : result;
}

export function createEconomicRouter(
  service: EconomicActionService,
  missions: MissionService,
  operatorToken: string,
): Router {
  const router = Router();
  router.post(
    '/execute',
    authenticated(operatorToken),
    validateBody(requestSchema),
    asyncHandler(async (request, response) => {
      const input = request.body as z.infer<typeof requestSchema>;
      const mission = await missions.get(input.missionId);
      const result = await service.execute({
        mission,
        capabilities: input.capabilities,
        budgetCurrency: input.budgetCurrency,
        executeBase: input.executeBase,
        actionId: input.actionId,
        paymentId: input.paymentId,
        ...(input.candidateLimit ? { candidateLimit: input.candidateLimit } : {}),
      });
      response.json({ success: true, data: serialized(result) });
    }),
  );
  return router;
}

export function createEconomicDashboardRouter(): Router {
  const router = Router();
  router.get('/economic-decisions', (_request, response) => {
    response
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continuity Economic Decision</title><style>body{font-family:system-ui;max-width:920px;margin:40px auto;padding:0 20px;background:#0b1020;color:#e7ecff}form,.panel{background:#151c32;padding:20px;border-radius:12px;margin:16px 0}label{display:block;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #566080;background:#0b1020;color:#fff}button{margin-top:18px;padding:11px 18px;background:#6d7cff;color:#fff;border:0;border-radius:7px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.chain{font-weight:700;color:#9ee6b8}</style></head><body><h1>Memory-driven economic decision</h1><p class="chain">Sibyl Memory → Agent Decision → Base Action</p><form id="economic-form"><label>Operator token</label><input id="token" type="password" autocomplete="off" required><label>Mission ID</label><input id="mission" required><label>Capabilities (comma separated)</label><input id="capabilities" value="research,fact-verification" required><label>Budget currency</label><input id="currency" value="USDC" required><label>Action ID</label><input id="action" value="economic-agent-payment" required><label>Payment ID</label><input id="payment" value="economic-payment" required><label><input id="execute" type="checkbox" style="width:auto"> Execute selected cost through Base</label><button type="submit">Recall, decide, and act</button></form><section class="panel"><h2>Decision</h2><div id="summary">No decision yet.</div><pre id="details"></pre></section><script src="/economic-decisions.js" defer></script></body></html>`,
      );
  });
  router.get('/economic-decisions.js', (_request, response) => {
    response
      .type('application/javascript')
      .send(
        `document.getElementById('economic-form').addEventListener('submit',async(e)=>{e.preventDefault();const byId=(id)=>document.getElementById(id);const body={missionId:byId('mission').value,capabilities:byId('capabilities').value.split(',').map(v=>v.trim()).filter(Boolean),budgetCurrency:byId('currency').value,actionId:byId('action').value,paymentId:byId('payment').value,executeBase:byId('execute').checked};const summary=byId('summary'),details=byId('details');summary.textContent='Recalling Sibyl evidence…';details.textContent='';try{const response=await fetch('/api/v1/economic-decisions/execute',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+byId('token').value},body:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message||'Request failed');const result=payload.data;summary.textContent=result.decision.selectedAgent.name+' | '+result.decision.estimatedCost.amount+' '+result.decision.estimatedCost.currency+' | expected verified success '+result.decision.expectedOutcome.verifiedSuccessProbability+' | Base '+result.baseAction.status;details.textContent=JSON.stringify(result,null,2)}catch(error){summary.textContent='Decision failed';details.textContent=error instanceof Error?error.message:String(error)}});`,
      );
  });
  return router;
}
