import { Hono } from "hono";
import { createLiveKitRoom, generateToken } from "../services/livekit.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { roomStore } from "./summary.js";
import * as crypto from "crypto";

export const roomsRouter = new Hono();

function generateSlug(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(8);
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars[bytes[i] % chars.length];
  }
  return slug;
}

// Sanitize name: strip HTML, limit length
function sanitizeName(raw: string): string {
  return raw.replace(/[<>"'&]/g, "").trim().slice(0, 40);
}

// Create a new room — max 5 per hour per IP
roomsRouter.post("/", rateLimiter({ windowMs: 60 * 60 * 1000, max: 5 }), async (c) => {
  const body = await c.req.json<{ hostName: string; email?: string; lang?: string }>();
  const { hostName, email, lang } = body;

  if (!hostName || hostName.trim().length === 0) {
    return c.json({ error: "hostName is required" }, 400);
  }

  const safeName = sanitizeName(hostName);
  if (safeName.length === 0) {
    return c.json({ error: "Invalid name" }, 400);
  }

  const slug = generateSlug();

  try {
    await createLiveKitRoom(slug);
  } catch (e) {
    console.error("Failed to create LiveKit room:", e);
    return c.json({ error: "Failed to create room" }, 500);
  }

  const hasEmail = !!(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  // Initialize room data for summary tracking
  roomStore.set(slug, {
    emails: new Map(),
    egressIds: [],
    lang: lang || "ru",
    recording: hasEmail,
    createdAt: Date.now(),
  });

  // Register host email if provided
  if (hasEmail) {
    roomStore.get(slug)!.emails.set(safeName, email!);
  }

  // Generate token for the host
  const token = await generateToken(slug, safeName, true);

  return c.json({ slug, token }, 201);
});

// Get room info — guest checks this before joining
roomsRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const roomData = roomStore.get(slug);

  if (!roomData) {
    return c.json({ slug, status: "not_found", recording: false }, 404);
  }

  return c.json({ slug, status: "active", recording: roomData.recording });
});

// Generate token — max 20 per hour per IP
roomsRouter.post("/:slug/token", rateLimiter({ windowMs: 60 * 60 * 1000, max: 20 }), async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json<{ name: string; email?: string }>();
  const { name, email } = body;

  if (!name || name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  const safeName = sanitizeName(name);
  if (safeName.length === 0) {
    return c.json({ error: "Invalid name" }, 400);
  }

  // Register guest email if provided
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const roomData = roomStore.get(slug);
    if (roomData) {
      roomData.emails.set(safeName, email);
    }
  }

  const token = await generateToken(slug, safeName, false);

  return c.json({ token });
});
