import { Hono } from "hono";
import { processCallRecording, cleanupRecordings } from "../services/ai-pipeline.js";
import { sendSummaryEmail, sendErrorEmail } from "../services/email.js";
import { listRoomEgress, stopEgress } from "../services/egress.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import * as fs from "fs";
import * as path from "path";

export const summaryRouter = new Hono();

// In-memory store for room data (emails, egress IDs, etc.)
interface RoomData {
  emails: Map<string, string>; // participantName -> email
  egressIds: string[];
  lang: string;
  recording: boolean; // true if host provided email
  createdAt: number;
}

export const roomStore = new Map<string, RoomData>();

/**
 * Register email for a participant in a room.
 * Protected: room must already exist (created via /rooms POST).
 * Rate limited to prevent spam.
 */
summaryRouter.post("/register-email", rateLimiter({ windowMs: 60 * 60 * 1000, max: 30 }), async (c) => {
  const { roomSlug, participantName, email } = await c.req.json<{
    roomSlug: string;
    participantName: string;
    email: string;
  }>();

  if (!roomSlug || !participantName || !email) {
    return c.json({ error: "roomSlug, participantName, and email are required" }, 400);
  }

  // Room MUST already exist — no creating rooms via this endpoint
  const data = roomStore.get(roomSlug);
  if (!data) {
    return c.json({ error: "Room not found" }, 404);
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email" }, 400);
  }

  // Limit emails per room (prevent abuse)
  if (data.emails.size >= 10) {
    return c.json({ error: "Max email registrations reached" }, 400);
  }

  // Sanitize name
  const safeName = participantName.replace(/[<>"'&]/g, "").trim().slice(0, 40);
  if (!safeName) {
    return c.json({ error: "Invalid name" }, 400);
  }

  data.emails.set(safeName, email);
  console.log(`Email registered: ${safeName} -> ${email} in room ${roomSlug}`);

  return c.json({ status: "ok" });
});

/**
 * Process summary for a completed room.
 * Called internally when a room ends (via webhook).
 */
export async function processRoomSummary(roomSlug: string) {
  const data = roomStore.get(roomSlug);
  if (!data || data.emails.size === 0) {
    console.log(`No emails registered for room ${roomSlug}, skipping summary`);
    return;
  }

  const recordingsDir = path.join(
    process.env.RECORDINGS_DIR || "/srv/livekit/recordings",
    roomSlug
  );

  // Wait a bit for egress files to finalize
  await new Promise((r) => setTimeout(r, 5000));

  // Find recording files
  let tracks: { participantName: string; filePath: string }[] = [];

  try {
    if (fs.existsSync(recordingsDir)) {
      const files = fs.readdirSync(recordingsDir).filter((f) => f.endsWith(".ogg"));
      tracks = files.map((f) => {
        const name = f.replace(/_{0,1}\d{4}-\d{2}.*\.ogg$/, "").replace(/_/g, " ") || f;
        return {
          participantName: name,
          filePath: path.join(recordingsDir, f),
        };
      });
    }
  } catch (e) {
    console.error(`Failed to read recordings for ${roomSlug}:`, e);
  }

  if (tracks.length === 0) {
    console.log(`No recording files found for room ${roomSlug}`);
    for (const email of data.emails.values()) {
      await sendErrorEmail(email, data.lang).catch(console.error);
    }
    return;
  }

  console.log(
    `Processing summary for room ${roomSlug}: ${tracks.length} tracks, ${data.emails.size} email recipients`
  );

  try {
    const result = await processCallRecording(tracks, data.lang);

    const participantNames = [...data.emails.keys()];
    const sendPromises = [...data.emails.values()].map((email) =>
      sendSummaryEmail(email, result.summary, roomSlug, participantNames, data.lang).catch(
        (e) => console.error(`Failed to send to ${email}:`, e)
      )
    );
    await Promise.all(sendPromises);

    console.log(`Summary sent for room ${roomSlug} to ${data.emails.size} recipients`);
  } catch (e) {
    console.error(`Summary generation failed for room ${roomSlug}:`, e);
    for (const email of data.emails.values()) {
      await sendErrorEmail(email, data.lang).catch(console.error);
    }
  } finally {
    cleanupRecordings(roomSlug);
    setTimeout(() => roomStore.delete(roomSlug), 60 * 60 * 1000);
  }
}

/**
 * Get summary status for a room (no sensitive data exposed).
 */
summaryRouter.get("/:roomSlug", async (c) => {
  const roomSlug = c.req.param("roomSlug");
  const data = roomStore.get(roomSlug);

  if (!data) {
    return c.json({ status: "not_found" }, 404);
  }

  return c.json({
    roomSlug,
    hasRecording: data.recording,
  });
});
