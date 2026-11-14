interface PickupSocket {
  timeout(ms: number): {
    emitWithAck(event: 'pickup', id: string): Promise<boolean>;
  };
}

/** Reintenta un ACK perdido con el mismo id; el recibo del servidor evita una segunda recogida. */
export async function claimPickup(socket: PickupSocket, id: string, done: (ok: boolean) => void, timeoutMs = 2500, active = () => true): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!active()) {
      done(false);
      return;
    }
    let ok: boolean;
    try {
      ok = await socket.timeout(timeoutMs).emitWithAck('pickup', id);
    } catch {
      continue;
    }
    // Un rechazo es definitivo: solo se reintentan fallos de transporte y timeouts.
    done(active() && ok === true);
    return;
  }
  done(false);
}
