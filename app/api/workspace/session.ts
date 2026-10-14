export function workspaceSession(request: Request) {
  const match = request.headers.get("cookie")?.match(/(?:^|;\s*)novel_ws=([a-f0-9-]{36})(?:;|$)/);
  const id = match?.[1] || crypto.randomUUID();
  return { id, fresh: !match, cookie: `novel_ws=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000` };
}

export function sessionResponse(data: unknown, session: ReturnType<typeof workspaceSession>, status = 200) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if(session.fresh)headers.set("Set-Cookie",session.cookie);
  return Response.json(data, { status, headers });
}
