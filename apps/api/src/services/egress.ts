import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
} from "livekit-server-sdk";

const livekitHost =
  process.env.LIVEKIT_API_URL || "https://livekit.kotik.space";
const apiKey = process.env.LIVEKIT_API_KEY!;
const apiSecret = process.env.LIVEKIT_API_SECRET!;

const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";

/**
 * Start room composite egress — records all audio into one file per room.
 * We use RoomCompositeEgress for simplicity: one file with all participants.
 *
 * For per-track recording, we'd need to start individual TrackEgress
 * per participant after they publish tracks. We handle that via webhooks.
 */
export async function startRoomEgress(roomName: string): Promise<string> {
  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.OGG,
    filepath: `${RECORDINGS_DIR}/${roomName}/{time}`,
  });

  const info = await egressClient.startRoomCompositeEgress(
    roomName,
    { file: fileOutput },
    { audioOnly: true }
  );

  console.log(`Egress started for room ${roomName}: ${info.egressId}`);
  return info.egressId;
}

/**
 * Start per-track egress for a specific audio track.
 * Called when a participant publishes an audio track.
 */
export async function startTrackEgress(
  roomName: string,
  trackId: string,
  participantName: string
): Promise<string> {
  // Sanitize participant name for filesystem
  const safeName = participantName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_");

  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.OGG,
    filepath: `${RECORDINGS_DIR}/${roomName}/${safeName}_{time}`,
  });

  const info = await egressClient.startTrackCompositeEgress(roomName, {
    file: fileOutput,
  }, {
    audioTrackId: trackId,
  });

  console.log(
    `Track egress started for ${participantName} in ${roomName}: ${info.egressId}`
  );
  return info.egressId;
}

/**
 * Stop a specific egress by ID.
 */
export async function stopEgress(egressId: string) {
  try {
    const info = await egressClient.stopEgress(egressId);
    console.log(`Egress stopped: ${egressId}, status: ${info.status}`);
    return info;
  } catch (e) {
    console.error(`Failed to stop egress ${egressId}:`, e);
  }
}

/**
 * List active egress for a room.
 */
export async function listRoomEgress(roomName: string) {
  return egressClient.listEgress({ roomName });
}
