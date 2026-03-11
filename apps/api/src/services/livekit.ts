import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const livekitHost =
  process.env.LIVEKIT_API_URL || "https://livekit.kotik.space";
const apiKey = process.env.LIVEKIT_API_KEY!;
const apiSecret = process.env.LIVEKIT_API_SECRET!;

if (!apiKey || !apiSecret) {
  throw new Error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env");
}

const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);

export async function createLiveKitRoom(roomName: string) {
  const room = await roomService.createRoom({
    name: roomName,
    emptyTimeout: 5 * 60, // 5 min
    maxParticipants: 10,
  });
  return room;
}

export async function generateToken(
  roomName: string,
  participantName: string,
  isHost: boolean = false
): Promise<string> {
  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    metadata: JSON.stringify({ isHost }),
    ttl: "12h",
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });
  return await token.toJwt();
}
