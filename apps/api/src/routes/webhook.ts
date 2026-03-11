import { Hono } from "hono";
import { WebhookReceiver } from "livekit-server-sdk";
import { startTrackEgress } from "../services/egress.js";
import { roomStore, processRoomSummary } from "./summary.js";

export const webhookRouter = new Hono();

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

// ─── Passive quality stats (zero impact on calls) ───
// Just reads data from webhooks that already arrive
interface ParticipantStats {
  name: string;
  joinedAt: number;
  leftAt?: number;
  tracks: number;
  reconnects: number;
}
interface RoomStats {
  roomName: string;
  startedAt: number;
  finishedAt?: number;
  participants: Map<string, ParticipantStats>;
}
const roomStats = new Map<string, RoomStats>();

function getRoomStats(roomName: string): RoomStats {
  if (!roomStats.has(roomName)) {
    roomStats.set(roomName, {
      roomName,
      startedAt: Date.now(),
      participants: new Map(),
    });
  }
  return roomStats.get(roomName)!;
}

function logRoomReport(roomName: string) {
  const stats = roomStats.get(roomName);
  if (!stats) return;

  const duration = stats.finishedAt
    ? Math.round((stats.finishedAt - stats.startedAt) / 1000)
    : 0;

  const parts: string[] = [];
  let totalReconnects = 0;
  stats.participants.forEach((p) => {
    const pDur = p.leftAt ? Math.round((p.leftAt - p.joinedAt) / 1000) : duration;
    totalReconnects += p.reconnects;
    parts.push(`  ${p.name}: ${pDur}s, ${p.tracks} tracks, ${p.reconnects} reconnects`);
  });

  console.log(
    `\n📊 ROOM REPORT: ${roomName}\n` +
    `  Duration: ${duration}s | Participants: ${stats.participants.size} | Reconnects: ${totalReconnects}\n` +
    parts.join("\n") +
    "\n"
  );

  // Cleanup after 1 hour
  setTimeout(() => roomStats.delete(roomName), 60 * 60 * 1000);
}

webhookRouter.post("/livekit", async (c) => {
  const body = await c.req.text();
  const authHeader = c.req.header("Authorization") || "";

  let event: any;
  try {
    event = await receiver.receive(body, authHeader);
  } catch (e) {
    console.error("Invalid webhook signature:", e);
    return c.json({ error: "Invalid signature" }, 401);
  }

  const eventType = event.event;
  console.log(`LiveKit webhook: ${eventType}`);

  switch (eventType) {
    case "room_started": {
      const roomName = event.room?.name;
      if (roomName) getRoomStats(roomName);
      break;
    }

    case "participant_joined": {
      const roomName = event.room?.name;
      const name = event.participant?.identity;
      if (roomName && name) {
        const stats = getRoomStats(roomName);
        const existing = stats.participants.get(name);
        if (existing) {
          // Same person rejoining = reconnect
          existing.reconnects++;
          existing.leftAt = undefined;
          console.log(`⚡ Reconnect: ${name} in ${roomName} (${existing.reconnects}x)`);
        } else {
          stats.participants.set(name, {
            name,
            joinedAt: Date.now(),
            tracks: 0,
            reconnects: 0,
          });
        }
      }
      break;
    }

    case "participant_left": {
      const roomName = event.room?.name;
      const name = event.participant?.identity;
      if (roomName && name) {
        const stats = getRoomStats(roomName);
        const p = stats.participants.get(name);
        if (p) p.leftAt = Date.now();
      }
      break;
    }

    case "track_published": {
      const roomName = event.room?.name;
      const trackSid = event.track?.sid;
      const participantName = event.participant?.identity;
      const trackSource = event.track?.source;

      console.log(`Track published: room=${roomName}, participant=${participantName}, trackSid=${trackSid}, source=${trackSource} (type: ${typeof trackSource})`);

      // Count tracks in stats
      if (roomName && participantName) {
        const stats = getRoomStats(roomName);
        const p = stats.participants.get(participantName);
        if (p) p.tracks++;
      }

      // LiveKit TrackSource: 0=UNKNOWN, 1=CAMERA, 2=MICROPHONE, 3=SCREEN_SHARE
      const isMic =
        trackSource === 2 ||
        trackSource === "2" ||
        trackSource === "MICROPHONE" ||
        String(trackSource).toUpperCase() === "MICROPHONE";

      if (roomName && trackSid && participantName && isMic) {
        const roomData = roomStore.get(roomName);
        console.log(`Room data for ${roomName}: emails=${roomData?.emails.size || 0}`);

        if (roomData && roomData.emails.size > 0) {
          try {
            const egressId = await startTrackEgress(roomName, trackSid, participantName);
            roomData.egressIds.push(egressId);
            console.log(`Egress started: ${egressId}`);
          } catch (e: any) {
            console.error(`Failed to start track egress for ${participantName}:`, e?.message || e);
          }
        } else {
          console.log(`No emails for room ${roomName}, skipping egress`);
        }
      } else {
        console.log(`Skipping non-mic track: source=${trackSource}, isMic=${isMic}`);
      }
      break;
    }

    case "room_finished": {
      const roomName = event.room?.name;
      if (roomName) {
        // Finalize stats
        const stats = roomStats.get(roomName);
        if (stats) stats.finishedAt = Date.now();
        logRoomReport(roomName);

        console.log(`Room finished: ${roomName}, triggering summary in 10s...`);
        setTimeout(() => {
          processRoomSummary(roomName).catch((e) =>
            console.error(`Summary failed for ${roomName}:`, e)
          );
        }, 10000);
      }
      break;
    }

    case "egress_ended": {
      const egressId = event.egressInfo?.egressId;
      const status = event.egressInfo?.status;
      console.log(`Egress ended: ${egressId}, status: ${status}`);
      break;
    }

    default:
      // Silently ignore other events (no more noisy "Unhandled" logs)
      break;
  }

  return c.json({ status: "ok" });
});
