import type { NextRequest } from "next/server";
import { authjs } from "@/lib/auth";

// Auth.js endpoints (sign-in page, OAuth callbacks, magic links, sign-out). Absent when cloud features are off.
const notFound = () => new Response("Not found", { status: 404 });

export function GET(request: NextRequest) {
  return authjs ? authjs.handlers.GET(request) : notFound();
}

export function POST(request: NextRequest) {
  return authjs ? authjs.handlers.POST(request) : notFound();
}
