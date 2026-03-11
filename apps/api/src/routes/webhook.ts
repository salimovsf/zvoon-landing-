import { Hono } from "hono";
import { WebhookReceiver } from "livekit-server-sdk";
import { startTrackEgress } from "../services/egress.js";
import { roomStore, processRoomSummary } from "./summary.js";

export const webhookRouter = new Hono();

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

webhookRouter.post("/livekit", async (c) => {
  const body = await c.req.text();
  const authHeader = c.req.header("Authorization") || "";

  let event;
  try {
    event = await receiver.receive(body, authHeader);
  } catch (e) {
    console.error("Invalid webhook signature:", e);
    return c.json({ error: "Invalid signature" }, 401);
  }

  console.log(`LiveKit webhook: ${event.event}`, JSON.stringify(event, null, 2).slice(0, 500));

  switch (event.event) {
    case "track_published": {
      // When a participant publishes an audio track, start per-track egress
      // Only if someone in this room wants a summary (has registered email)
      const roomName = event.room?.name;
      const trackSid = event.track?.sid;
      const participantName = event.participant?.identity;

      if (roomName && trackSid && participantName && event.track?.source === 1) {
        // source 1 = MICROPHONE
        const roomData = roomStore.get(roomName);
        if (roomData && roomData.emails.size > 0) {
          try {
            const egressId = await startTrackEgress(roomName, trackSid, participantName);
            roomData.egressIds.push(egressId);
          } catch (e) {
            console.error(`Failed to start track egress for ${participantName}:`, e);
          }
        }
      }
      break;
    }

    case "room_finished": {
      // Room ended — trigger summary processing
      const roomName = event.room?.name;
      if (roomName) {
        console.log(`Room finished: ${roomName}, triggering summary...`);
        // Small delay to let egress finalize files
        setTimeout(() => {
          processRoomSummary(roomName).catch(console.error);
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
  }

  return c.json({ status: "ok" });
});
