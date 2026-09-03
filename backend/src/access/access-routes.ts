import express, { Router, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AccessService } from './access-service.js';
import {
  accessAuthenticated,
  accessCookieName,
  accessPrincipal,
  cookieValue,
} from './access-http.js';
import { accessRoles } from './access.js';
import { asyncHandler } from '../shared/http/async-handler.js';
import { validateBody, validateParams } from '../shared/http/validation.js';
import { bearerAuthenticated } from '../shared/http/bearer-auth.js';

const requestId = z.object({ id: z.string().uuid() }).strict();
const amount = z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const acceptSchema = z
  .object({
    token: z.string().min(32).max(200),
    name: z.string().trim().min(2).max(120),
    password: z.string().min(12).max(200),
  })
  .strict();
const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(200),
    organizationId: z.string().uuid().optional(),
  })
  .strict();
const approveSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(120),
    organizationMode: z.enum(['CUSTOMER', 'JUDGE']),
    role: z.enum(accessRoles),
    spendingEnabled: z.boolean(),
    maximumMissionBudget: amount,
    maximumAcpJobUsdc: amount,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.organizationMode === 'JUDGE' && value.role !== 'JUDGE') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: 'Judge workspaces require the JUDGE role',
      });
    }
    if (value.organizationMode === 'CUSTOMER' && value.role === 'JUDGE') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: 'Customer workspaces cannot use the JUDGE role',
      });
    }
  });
const rejectSchema = z.object({ reviewNote: z.string().trim().max(500).optional() }).strict();

function setSessionCookie(response: Response, token: string, expiresAt: Date, production: boolean) {
  response.cookie(accessCookieName, token, {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function createAccessRouter(service: AccessService, production: boolean): Router {
  const router = Router();
  router.post(
    '/accept-invitation',
    validateBody(acceptSchema),
    asyncHandler(async (request, response) => {
      const session = await service.acceptInvitation(request.body as z.infer<typeof acceptSchema>);
      setSessionCookie(response, session.token, session.expiresAt, production);
      response.status(201).json({ success: true, data: { principal: session.principal } });
    }),
  );
  router.post(
    '/login',
    validateBody(loginSchema),
    asyncHandler(async (request, response) => {
      const body = request.body as z.infer<typeof loginSchema>;
      const session = await service.login({
        email: body.email,
        password: body.password,
        ...(body.organizationId ? { organizationId: body.organizationId } : {}),
      });
      setSessionCookie(response, session.token, session.expiresAt, production);
      response.json({ success: true, data: { principal: session.principal } });
    }),
  );
  router.post(
    '/logout',
    asyncHandler(async (request, response) => {
      const token = cookieValue(request, accessCookieName);
      if (token) await service.revoke(token);
      response.clearCookie(accessCookieName, {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        path: '/',
      });
      response.status(204).end();
    }),
  );
  router.get(
    '/me',
    accessAuthenticated(service),
    asyncHandler((_request, response) => {
      response.json({ success: true, data: { principal: accessPrincipal(response) } });
    }),
  );
  return router;
}

export function createAccessAdminRouter(service: AccessService, operatorToken: string): Router {
  const router = Router();
  router.use(bearerAuthenticated(operatorToken, 'ACCESS_ADMIN_UNAUTHORIZED'));
  router.get(
    '/requests',
    asyncHandler(async (_request, response) => {
      response.json({ success: true, data: { requests: await service.listRequests() } });
    }),
  );
  router.post(
    '/requests/:id/approve',
    validateParams(requestId),
    validateBody(approveSchema),
    asyncHandler(async (request, response) => {
      response.status(201).json({
        success: true,
        data: await service.approve({
          requestId: String(request.params.id),
          ...(request.body as z.infer<typeof approveSchema>),
        }),
      });
    }),
  );
  router.post(
    '/requests/:id/reject',
    validateParams(requestId),
    validateBody(rejectSchema),
    asyncHandler(async (request, response) => {
      const body = request.body as z.infer<typeof rejectSchema>;
      response.json({
        success: true,
        data: { request: await service.reject(String(request.params.id), body.reviewNote) },
      });
    }),
  );
  router.post(
    '/requests/:id/reissue',
    validateParams(requestId),
    asyncHandler(async (request, response) => {
      response
        .status(201)
        .json({ success: true, data: await service.reissue(String(request.params.id)) });
    }),
  );
  return router;
}

const accessPublicDirectory = fileURLToPath(new URL('../../../public/access', import.meta.url));

export function createAccessUiRouter(): Router {
  const router = Router();
  router.use(
    '/access-ui',
    express.static(accessPublicDirectory, { index: false, etag: true, maxAge: '1h' }),
  );
  for (const path of ['/access', '/access/invite', '/portal']) {
    router.get(path, (_request, response) =>
      response.sendFile('index.html', { root: accessPublicDirectory }),
    );
  }
  return router;
}
