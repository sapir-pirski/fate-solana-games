import { timingSafeEqual } from "node:crypto";

export function authorizeAutomation(request: Request) {
  const configured = process.env.AUTOMATION_TOKEN?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!configured || !supplied) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function unauthorized() {
  return Response.json({ code: "UNAUTHORIZED" }, {
    status: 401,
    headers: { "cache-control": "no-store", "www-authenticate": "Bearer" },
  });
}
