// In-memory WebRTC signaling hub. Assumes a single server instance, which is how
// this app runs on Railway; peers only exchange small SDP/ICE messages through it.

export interface PeerInfo {
  id: string;
  name: string;
}

interface Connection extends PeerInfo {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

const globalStore = globalThis as unknown as { __nasSignal?: Map<string, Connection> };
const peers = (globalStore.__nasSignal ??= new Map<string, Connection>());

function broadcastPresence() {
  const list: PeerInfo[] = Array.from(peers.values(), ({ id, name }) => ({ id, name }));
  for (const peer of peers.values()) peer.send('presence', list);
}

export function join(connection: Connection) {
  const existing = peers.get(connection.id);
  if (existing) existing.close();
  peers.set(connection.id, connection);
  broadcastPresence();
}

export function leave(id: string, connection: Connection) {
  if (peers.get(id) === connection) {
    peers.delete(id);
    broadcastPresence();
  }
}

export function relay(from: string, to: string, payload: unknown): boolean {
  const sender = peers.get(from);
  const target = peers.get(to);
  if (!sender || !target) return false;
  target.send('signal', { from: { id: sender.id, name: sender.name }, payload });
  return true;
}

export const isValidPeerId = (id: string | null): id is string => !!id && /^[a-z0-9-]{8,64}$/.test(id);
