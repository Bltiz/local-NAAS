export interface Peer {
  id: string;
  name: string;
}

export interface TransferFile {
  path: string;
  size: number;
}

export type TransferStatus =
  | 'requesting'
  | 'incoming'
  | 'connecting'
  | 'transferring'
  | 'done'
  | 'declined'
  | 'failed'
  | 'canceled';

export type Route = 'Same network' | 'Direct over internet' | 'Relayed';

export interface Transfer {
  id: string;
  direction: 'send' | 'receive';
  peer: Peer;
  files: TransferFile[];
  totalBytes: number;
  bytes: number;
  status: TransferStatus;
  bytesPerSecond: number;
  route?: Route;
  error?: string;
  savedTo?: string;
}

export interface DirectSnapshot {
  selfId: string;
  selfName: string;
  online: boolean;
  peers: Peer[];
  transfers: Transfer[];
}

type Signal =
  | { kind: 'request'; transferId: string; files: TransferFile[] }
  | { kind: 'accept'; transferId: string }
  | { kind: 'decline'; transferId: string }
  | { kind: 'cancel'; transferId: string; reason?: string }
  | { kind: 'offer'; transferId: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; transferId: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; transferId: string; candidate: RTCIceCandidateInit };

type ControlMessage =
  | { t: 'file'; i: number }
  | { t: 'end'; i: number }
  | { t: 'done' }
  | { t: 'complete' };

interface Sink {
  label: string;
  open(file: TransferFile): Promise<FileWriter>;
}

interface FileWriter {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface State extends Transfer {
  localFiles?: File[];
  pc?: RTCPeerConnection;
  channel?: RTCDataChannel;
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
  sink?: Sink;
  writer?: FileWriter;
  writerBytes: number;
  chain: Promise<void>;
  samples: { t: number; bytes: number }[];
  timer?: ReturnType<typeof setTimeout>;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const READ_SLICE = 4 * 1024 * 1024;
const HIGH_WATER = 16 * 1024 * 1024;
const LOW_WATER = 4 * 1024 * 1024;
const CONNECT_TIMEOUT = 30_000;
const REQUEST_TIMEOUT = 120_000;

interface PickerWindow {
  showSaveFilePicker?: (o?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (o?: { mode?: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows PC'
          : /Mac/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux PC'
              : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  for (const probe of [() => dir.getFileHandle(name), () => dir.getDirectoryHandle(name)]) {
    try {
      await probe();
      return true;
    } catch {}
  }
  return false;
}

async function uniqueName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  if (!(await exists(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
}

function writableWriter(writable: FileSystemWritableFileStream): FileWriter {
  return {
    write: (data) => writable.write(data),
    close: () => writable.close(),
    abort: () => writable.abort(),
  };
}

function directorySink(root: FileSystemDirectoryHandle): Sink {
  const topNames = new Map<string, Promise<string>>();
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  const dirFor = (rel: string): Promise<FileSystemDirectoryHandle> => {
    if (!rel) return Promise.resolve(root);
    let handle = dirs.get(rel);
    if (!handle) {
      const slash = rel.lastIndexOf('/');
      const parent = slash < 0 ? '' : rel.slice(0, slash);
      handle = dirFor(parent).then((p) => p.getDirectoryHandle(rel.slice(slash + 1), { create: true }));
      dirs.set(rel, handle);
    }
    return handle;
  };
  return {
    label: root.name,
    async open(file) {
      const segments = file.path.split('/');
      if (segments.length > 1) {
        // Rename a colliding top-level folder once, so nothing already on disk is touched.
        let top = topNames.get(segments[0]);
        if (!top) {
          top = uniqueName(root, segments[0]);
          topNames.set(segments[0], top);
        }
        segments[0] = await top;
      }
      const dir = await dirFor(segments.slice(0, -1).join('/'));
      const name = segments.length === 1 ? await uniqueName(dir, segments[0]) : segments[segments.length - 1];
      const handle = await dir.getFileHandle(name, { create: true });
      return writableWriter(await handle.createWritable());
    },
  };
}

function singleFileSink(handle: FileSystemFileHandle): Sink {
  return {
    label: handle.name,
    async open() {
      return writableWriter(await handle.createWritable());
    },
  };
}

function memorySink(): Sink {
  return {
    label: 'Downloads',
    async open(file) {
      const parts: ArrayBuffer[] = [];
      return {
        async write(data) {
          parts.push(data);
        },
        async close() {
          const url = URL.createObjectURL(new Blob(parts));
          const a = document.createElement('a');
          a.href = url;
          a.download = file.path.slice(file.path.lastIndexOf('/') + 1);
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        async abort() {
          parts.length = 0;
        },
      };
    },
  };
}

export class DirectShare {
  readonly selfId = randomId();
  private selfName: string;
  private source: EventSource | null = null;
  private online = false;
  private peers: Peer[] = [];
  private transfers = new Map<string, State>();
  private listeners = new Set<() => void>();
  private snapshot: DirectSnapshot;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(name: string) {
    this.selfName = name;
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  connect() {
    if (this.disposed) return;
    this.source?.close();
    const url = `/api/rtc/events?id=${this.selfId}&name=${encodeURIComponent(this.selfName)}`;
    const source = new EventSource(url);
    this.source = source;
    source.onopen = () => {
      this.online = true;
      this.notify(true);
    };
    source.addEventListener('presence', (e) => {
      this.peers = (JSON.parse((e as MessageEvent).data) as Peer[]).filter((p) => p.id !== this.selfId);
      this.notify(true);
    });
    source.addEventListener('signal', (e) => {
      const { from, payload } = JSON.parse((e as MessageEvent).data) as { from: Peer; payload: Signal };
      this.onSignal(from, payload).catch((err) => console.error('signal error', err));
    });
    source.onerror = () => {
      this.online = false;
      this.notify(true);
      if (source.readyState === EventSource.CLOSED && !this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.connect();
        }, 5000);
      }
    };
  }

  rename(name: string) {
    this.selfName = name.trim().slice(0, 60) || defaultDeviceName();
    this.connect();
    this.notify(true);
  }

  dispose() {
    this.disposed = true;
    this.source?.close();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const state of this.transfers.values()) this.teardown(state);
  }

  send(peer: Peer, files: { file: File; path: string }[]) {
    const id = randomId();
    const state = this.createState({
      id,
      direction: 'send',
      peer,
      files: files.map((f) => ({ path: f.path, size: f.file.size })),
      status: 'requesting',
    });
    state.localFiles = files.map((f) => f.file);
    state.timer = setTimeout(() => this.fail(state, 'No answer from the other device.'), REQUEST_TIMEOUT);
    this.signal(peer.id, { kind: 'request', transferId: id, files: state.files }).catch(() =>
      this.fail(state, 'That device is no longer online.'),
    );
    this.notify(true);
  }

  // Must be called from a click handler: the save pickers need a user gesture.
  async accept(id: string): Promise<void> {
    const state = this.transfers.get(id);
    if (!state || state.status !== 'incoming') return;
    const picker = window as unknown as PickerWindow;
    try {
      if (state.files.length === 1 && picker.showSaveFilePicker) {
        const name = state.files[0].path.slice(state.files[0].path.lastIndexOf('/') + 1);
        state.sink = singleFileSink(await picker.showSaveFilePicker({ suggestedName: name }));
      } else if (picker.showDirectoryPicker) {
        state.sink = directorySink(await picker.showDirectoryPicker({ mode: 'readwrite' }));
      } else {
        state.sink = memorySink();
      }
    } catch {
      return;
    }
    state.savedTo = state.sink.label;
    state.status = 'connecting';
    clearTimeout(state.timer);
    state.timer = setTimeout(() => this.fail(state, 'Could not connect directly.'), CONNECT_TIMEOUT);
    this.notify(true);
    await this.signal(state.peer.id, { kind: 'accept', transferId: id }).catch(() =>
      this.fail(state, 'That device is no longer online.'),
    );
  }

  decline(id: string) {
    const state = this.transfers.get(id);
    if (!state || state.status !== 'incoming') return;
    state.status = 'declined';
    this.signal(state.peer.id, { kind: 'decline', transferId: id }).catch(() => {});
    this.teardown(state);
    this.notify(true);
  }

  cancel(id: string) {
    const state = this.transfers.get(id);
    if (!state || ['done', 'declined', 'failed', 'canceled'].includes(state.status)) return;
    state.status = 'canceled';
    this.signal(state.peer.id, { kind: 'cancel', transferId: id }).catch(() => {});
    this.teardown(state);
    this.notify(true);
  }

  dismiss(id: string) {
    const state = this.transfers.get(id);
    if (state && ['done', 'declined', 'failed', 'canceled'].includes(state.status)) {
      this.transfers.delete(id);
      this.notify(true);
    }
  }

  private createState(t: Pick<Transfer, 'id' | 'direction' | 'peer' | 'files' | 'status'>): State {
    const state: State = {
      ...t,
      totalBytes: t.files.reduce((a, f) => a + f.size, 0),
      bytes: 0,
      bytesPerSecond: 0,
      pendingIce: [],
      remoteSet: false,
      writerBytes: 0,
      chain: Promise.resolve(),
      samples: [],
    };
    this.transfers.set(t.id, state);
    return state;
  }

  private async signal(to: string, payload: Signal) {
    const res = await fetch('/api/rtc/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.selfId, to, payload }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Signal failed');
  }

  private async onSignal(from: Peer, msg: Signal) {
    if (msg.kind === 'request') {
      if (this.transfers.has(msg.transferId)) return;
      this.createState({ id: msg.transferId, direction: 'receive', peer: from, files: msg.files, status: 'incoming' });
      this.notify(true);
      return;
    }
    const state = this.transfers.get(msg.transferId);
    if (!state || state.peer.id !== from.id) return;

    switch (msg.kind) {
      case 'accept':
        if (state.direction !== 'send' || state.status !== 'requesting') return;
        clearTimeout(state.timer);
        state.status = 'connecting';
        state.timer = setTimeout(() => this.fail(state, 'Could not connect directly.'), CONNECT_TIMEOUT);
        this.notify(true);
        await this.startOffer(state);
        break;
      case 'decline':
        state.status = 'declined';
        this.teardown(state);
        this.notify(true);
        break;
      case 'cancel':
        if (['done', 'failed', 'declined'].includes(state.status)) return;
        state.status = 'canceled';
        state.error = 'Canceled by the other device.';
        this.teardown(state);
        this.notify(true);
        break;
      case 'offer':
        if (state.direction !== 'receive') return;
        await this.answerOffer(state, msg.sdp);
        break;
      case 'answer':
        if (!state.pc) return;
        await state.pc.setRemoteDescription(msg.sdp);
        await this.flushIce(state);
        break;
      case 'ice':
        if (state.pc && state.remoteSet) await state.pc.addIceCandidate(msg.candidate).catch(() => {});
        else state.pendingIce.push(msg.candidate);
        break;
    }
  }

  private newPeerConnection(state: State): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    state.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signal(state.peer.id, { kind: 'ice', transferId: state.id, candidate: e.candidate.toJSON() }).catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail(state, 'The direct connection dropped.');
    };
    return pc;
  }

  private async flushIce(state: State) {
    state.remoteSet = true;
    for (const candidate of state.pendingIce.splice(0)) await state.pc?.addIceCandidate(candidate).catch(() => {});
  }

  private async startOffer(state: State) {
    const pc = this.newPeerConnection(state);
    const channel = pc.createDataChannel('files', { ordered: true });
    channel.binaryType = 'arraybuffer';
    state.channel = channel;
    channel.onopen = () => this.runSend(state).catch((err) => this.fail(state, err instanceof Error ? err.message : 'Send failed'));
    channel.onmessage = (e) => {
      if (typeof e.data === 'string' && (JSON.parse(e.data) as ControlMessage).t === 'complete') this.finish(state);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.signal(state.peer.id, { kind: 'offer', transferId: state.id, sdp: offer });
  }

  private async answerOffer(state: State, sdp: RTCSessionDescriptionInit) {
    const pc = this.newPeerConnection(state);
    pc.ondatachannel = (e) => {
      const channel = e.channel;
      channel.binaryType = 'arraybuffer';
      state.channel = channel;
      channel.onopen = () => this.markTransferring(state);
      channel.onmessage = (ev) => {
        const data = ev.data as string | ArrayBuffer;
        state.chain = state.chain.then(() => this.onReceive(state, data)).catch((err) => {
          this.fail(state, err instanceof Error ? err.message : 'Could not save file');
        });
      };
    };
    await pc.setRemoteDescription(sdp);
    await this.flushIce(state);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.signal(state.peer.id, { kind: 'answer', transferId: state.id, sdp: answer });
  }

  private markTransferring(state: State) {
    if (state.status !== 'connecting') return;
    clearTimeout(state.timer);
    state.status = 'transferring';
    this.notify(true);
    this.detectRoute(state);
  }

  private async detectRoute(state: State) {
    try {
      const stats = await state.pc!.getStats();
      let pairId: string | undefined;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
      });
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach((s) => {
        if ((pairId && s.id === pairId) || (!pairId && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')) pair = s;
      });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const types = [local?.candidateType, remote?.candidateType];
      state.route = types.includes('relay') ? 'Relayed' : types.every((t) => t === 'host') ? 'Same network' : 'Direct over internet';
      this.notify(true);
    } catch {}
  }

  private async runSend(state: State) {
    const channel = state.channel!;
    const files = state.localFiles!;
    this.markTransferring(state);
    const maxMessage = Math.min(state.pc?.sctp?.maxMessageSize || 65536, 256 * 1024);
    channel.bufferedAmountLowThreshold = LOW_WATER;

    const drain = () =>
      channel.bufferedAmount < HIGH_WATER
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const onLow = () => {
              channel.removeEventListener('bufferedamountlow', onLow);
              channel.removeEventListener('close', onClose);
              resolve();
            };
            const onClose = () => reject(new Error('The direct connection closed.'));
            channel.addEventListener('bufferedamountlow', onLow);
            channel.addEventListener('close', onClose);
          });

    for (const [i, file] of files.entries()) {
      channel.send(JSON.stringify({ t: 'file', i } satisfies ControlMessage));
      for (let pos = 0; pos < file.size; pos += READ_SLICE) {
        const slice = await file.slice(pos, pos + READ_SLICE).arrayBuffer();
        for (let off = 0; off < slice.byteLength; off += maxMessage) {
          if (state.status !== 'transferring') throw new Error('Canceled');
          await drain();
          const part = slice.slice(off, off + maxMessage);
          channel.send(part);
          state.bytes += part.byteLength;
          this.notify();
        }
      }
      channel.send(JSON.stringify({ t: 'end', i } satisfies ControlMessage));
    }
    channel.send(JSON.stringify({ t: 'done' } satisfies ControlMessage));
  }

  private async onReceive(state: State, data: string | ArrayBuffer) {
    if (state.status !== 'transferring') return;
    if (typeof data !== 'string') {
      if (!state.writer) throw new Error('Received data out of order.');
      await state.writer.write(data);
      state.writerBytes += data.byteLength;
      state.bytes += data.byteLength;
      this.notify();
      return;
    }
    const msg = JSON.parse(data) as ControlMessage;
    if (msg.t === 'file') {
      state.writer = await state.sink!.open(state.files[msg.i]);
      state.writerBytes = 0;
    } else if (msg.t === 'end') {
      const expected = state.files[msg.i].size;
      if (state.writerBytes !== expected) {
        await state.writer?.abort();
        throw new Error(`${state.files[msg.i].path} arrived incomplete.`);
      }
      await state.writer!.close();
      state.writer = undefined;
    } else if (msg.t === 'done') {
      state.channel?.send(JSON.stringify({ t: 'complete' } satisfies ControlMessage));
      this.finish(state);
    }
  }

  private finish(state: State) {
    if (state.status !== 'transferring') return;
    state.status = 'done';
    state.bytes = state.totalBytes;
    this.notify(true);
    setTimeout(() => this.teardown(state), 1000);
  }

  private fail(state: State, message: string) {
    if (['done', 'declined', 'failed', 'canceled'].includes(state.status)) return;
    state.status = 'failed';
    state.error = message;
    this.signal(state.peer.id, { kind: 'cancel', transferId: state.id, reason: message }).catch(() => {});
    this.teardown(state);
    this.notify(true);
  }

  private teardown(state: State) {
    clearTimeout(state.timer);
    state.writer?.abort().catch(() => {});
    state.writer = undefined;
    try {
      state.channel?.close();
    } catch {}
    state.pc?.close();
    state.channel = undefined;
    state.pc = undefined;
    state.localFiles = state.status === 'done' ? undefined : state.localFiles;
  }

  private notify(immediate = false) {
    if (immediate) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      this.snapshot = this.build();
      for (const l of this.listeners) l();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.snapshot = this.build();
      for (const l of this.listeners) l();
    }, 150);
  }

  private build(): DirectSnapshot {
    const now = performance.now();
    const transfers = Array.from(this.transfers.values(), (s) => {
      if (s.status === 'transferring') {
        s.samples.push({ t: now, bytes: s.bytes });
        while (s.samples.length > 2 && now - s.samples[0].t > 3000) s.samples.shift();
        const first = s.samples[0];
        const elapsed = (now - first.t) / 1000;
        s.bytesPerSecond = elapsed > 0.3 ? (s.bytes - first.bytes) / elapsed : 0;
      } else {
        s.bytesPerSecond = 0;
      }
      const { id, direction, peer, files, totalBytes, bytes, status, bytesPerSecond, route, error, savedTo } = s;
      return { id, direction, peer, files, totalBytes, bytes, status, bytesPerSecond, route, error, savedTo };
    });
    return { selfId: this.selfId, selfName: this.selfName, online: this.online, peers: this.peers, transfers };
  }
}
