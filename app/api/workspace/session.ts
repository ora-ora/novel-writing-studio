export const SHARED_WORKSPACE_ID = "shared";

// All visitors intentionally share the same database workspace. Older browser
// cookies remain harmless and never determine access to works or chapters.
export function workspaceSession(_request: Request) {
  return { id: SHARED_WORKSPACE_ID };
}

export function sessionResponse(data: unknown, _session: ReturnType<typeof workspaceSession>, status = 200) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  return Response.json(data, { status, headers });
}
