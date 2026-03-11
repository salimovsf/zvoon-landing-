import { Hono } from "hono";
import { processCallRecording, cleanupRecordings } from "../services/ai-pipeline.js";
import { sendSummaryEmail, sendErrorEmail } from "../services/email.js";
import { listRoomEgress, stopEgress } from "../services/egress.js";
import * as fs from "fs";
import * as path from "path";

export const summaryRouter = new Hono();

// In-memory store for room data (emails, egress IDs, etc.)
// In production, this should be in a database
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
 * Called from the frontend when user enters their email.
 */
summaryRouter.post("/register-email", async (c) => {
  const { roomSlug, participantName, email } = await c.req.json<{
    roomSlug: string;
    participantName: string;
    email: string;
  }>();

  if (!roomSlug || !participantName || !email) {
    return c.json({ error: "roomSlug, participantName, and email are required" }, 400);
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email" }, 400);
  }

  if (!roomStore.has(roomSlug)) {
    roomStore.set(roomSlug, {
      emails: new Map(),
      egressIds: [],
      lang: "ru",
      recording: true,
      createdAt: Date.now(),
    });
  }

  const data = roomStore.get(roomSlug)!;
  data.emails.set(participantName, email);

  console.log(`Email registered: ${participantName} -> ${email} in room ${roomSlug}`);

  return c.json({ status: "ok" });
});

/**
 * Process summary for a completed room.
 * Called internally when a room ends (via webhook or manual trigger).
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
        // Extract participant name from filename: "Name_timestamp.ogg"
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
    // Notify users about the error
    for (const email of data.emails.values()) {
      await sendErrorEmail(email, data.lang).catch(console.error);
    }
    return;
  }

  console.log(
    `Processing summary for room ${roomSlug}: ${tracks.length} tracks, ${data.emails.size} email recipients`
  );

  try {
    // Generate summary via Gemini
    const result = await processCallRecording(tracks, data.lang);

    // Send to all registered emails
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
    // Send error emails
    for (const email of data.emails.values()) {
      await sendErrorEmail(email, data.lang).catch(console.error);
    }
  } finally {
    // Cleanup recordings (GDPR)
    cleanupRecordings(roomSlug);
    // Cleanup memory (after 1 hour to handle late requests)
    setTimeout(() => roomStore.delete(roomSlug), 60 * 60 * 1000);
  }
}

/**
 * Manual trigger for testing: POST /summary/trigger
 */
summaryRouter.post("/trigger", async (c) => {
  const { roomSlug } = await c.req.json<{ roomSlug: string }>();

  if (!roomSlug) {
    return c.json({ error: "roomSlug is required" }, 400);
  }

  // Process async — don't block the response
  processRoomSummary(roomSlug).catch(console.error);

  return c.json({ status: "processing" });
});

/**
 * Get summary status for a room.
 */
summaryRouter.get("/:roomSlug", async (c) => {
  const roomSlug = c.req.param("roomSlug");
  const data = roomStore.get(roomSlug);

  if (!data) {
    return c.json({ status: "not_found" }, 404);
  }

  return c.json({
    roomSlug,
    emailCount: data.emails.size,
    hasEgress: data.egressIds.length > 0,
  });
});
