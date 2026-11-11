import type { Response } from "express";
import { ZodError } from "zod";
import { isAxiosError } from "axios";
import { logger } from "./logger";

// An error whose message is safe to show to the user.
export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

// Turn any error into { status, message } for the client. Only messages we wrote
// ourselves are shown; anything unexpected becomes a generic message, and the real
// cause goes to the server log (without tokens or other secrets).
export function sendError(res: Response, e: unknown, context: string) {
  const { status, message, log } = classify(e);
  if (status >= 500) logger.error({ context, ...log }, message);
  else logger.info({ context, status, ...log }, message);
  res.status(status).json({ error: message });
}

function classify(e: unknown): { status: number; message: string; log: Record<string, unknown> } {
  if (e instanceof HttpError) {
    return { status: e.status, message: e.message, log: e.detail ? { detail: e.detail } : {} };
  }

  if (e instanceof ZodError) {
    const issue = e.issues[0];
    // Messages we wrote for users are full sentences; show those as they are
    if (issue?.message && /^[A-Z].*\.$/.test(issue.message)) {
      return { status: 400, message: issue.message, log: {} };
    }
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return { status: 400, message: `Invalid request. ${where}${issue?.message ?? ""}`.trim(), log: {} };
  }

  if (isAxiosError(e)) {
    // Never log e.config: its params contain the Mapbox access token
    const url = e.config?.url ? safeUrl(e.config.url) : undefined;
    const status = e.response?.status;
    const log = { upstream: url, upstreamStatus: status, code: e.code };
    const isMapbox = url?.includes("mapbox.com");
    if (status === 401 || status === 403) {
      return { status: 500, message: "The server isn't configured correctly. Please try again later.", log };
    }
    if (isMapbox && status === 422) {
      // e.g. "Route exceeds maximum distance limitation"
      const detail = (e.response?.data as { message?: string } | undefined)?.message;
      return { status: 422, message: `No route could be found${detail ? `: ${detail}` : "."}`, log };
    }
    if (status === 429) {
      return { status: 503, message: "The map service is busy right now. Please try again in a few minutes.", log };
    }
    return {
      status: 502,
      message: isMapbox
        ? "The routing service didn't respond. Please try again in a moment."
        : "An external service didn't respond. Please try again in a moment.",
      log,
    };
  }

  const err = e as Error | undefined;
  return { status: 500, message: "Something went wrong. Please try again.", log: { err: err?.message, stack: err?.stack } };
}

function safeUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.host}${url.pathname.split("/").slice(0, 4).join("/")}`; // no query, no coordinates
  } catch {
    return "unknown";
  }
}
