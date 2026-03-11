import { Hono } from "hono";
import { createLiveKitRoom, generateToken } from "../services/livekit.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { roomStore } from "./summary.js";

export const roomsRouter = new Hono();

function generateSlug(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}

// Create a new room — max 5 per hour per IP
roomsRouter.post("/", rateLimiter({ windowMs: 60 * 60 * 1000, max: 5 }), async (c) => {
  const body = await c.req.json<{ hostName: string; email?: string; lang?: string }>();
  const { hostName, email, lang } = body;

  if (!hostName || hostName.trim().length === 0) {
    return c.json({ error: "hostName is required" }, 400);
  }

  const slug = generateSlug();

  try {
    await createLiveKitRoom(slug);
  } catch (e) {
    console.error("Failed to create LiveKit room:", e);
    return c.json({ error: "Failed to create room" }, 500);
  }

  // Initialize room data for summary tracking
  roomStore.set(slug, {
    emails: new Map(),
    egressIds: [],
    lang: lang || "ru",
    createdAt: Date.now(),
  });

  // Register host email if provided
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    roomStore.get(slug)!.emails.set(hostName.trim(), email);
  }

  // Generate token for the host
  const token = await generateToken(slug, hostName.trim(), true);

  return c.json({ slug, token }, 201);
});

// Get room info
roomsRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // For MVP: just confirm the room exists by slug format
  return c.json({ slug, status: "active" });
});

// Generate token — max 20 per hour per IP
roomsRouter.post("/:slug/token", rateLimiter({ windowMs: 60 * 60 * 1000, max: 20 }), async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json<{ name: string; email?: string }>();
  const { name, email } = body;

  if (!name || name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  // Register guest email if provided
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const roomData = roomStore.get(slug);
    if (roomData) {
      roomData.emails.set(name.trim(), email);
    }
  }

  const token = await generateToken(slug, name.trim(), false);

  return c.json({ token });
});
