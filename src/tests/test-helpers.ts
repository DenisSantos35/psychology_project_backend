import type { NextFunction, Request, Response } from "express";

export type MockResponse = {
  statusCode: number;
  body: unknown;
  locals: Record<string, unknown>;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  send(payload?: unknown): MockResponse;
};

export function createMockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    body: undefined,
    locals: {},
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
    send(payload?: unknown) {
      response.body = payload;
      return response;
    },
  } as MockResponse;

  return response;
}

export function createMockRequest(overrides: Partial<Request> & { method: string; url: string; path?: string }) {
  const request: Record<string, unknown> = {
    headers: {},
    body: {},
    query: {},
    params: {},
    ip: "127.0.0.1",
  };
  return Object.assign(request, overrides) as Request;
}

export async function runExpressHandler(
  handler: (request: Request, response: Response, next: NextFunction) => unknown,
  request: Request,
  response: Response,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    handler(request, response, (error?: unknown) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
