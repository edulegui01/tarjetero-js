// Puerto de DebounceGuard.kt: descarta lecturas repetidas del mismo cardNo
// dentro de una ventana corta (no hay documentación del comportamiento
// exacto del lector, así que esto actúa como red de seguridad).

class DebounceGuard {
  constructor() {
    this.lastSeenAt = new Map();
  }

  shouldProcess(cardCode, windowSeconds, now = Date.now()) {
    const lastSeen = this.lastSeenAt.get(cardCode);
    const windowMillis = windowSeconds * 1000;
    if (lastSeen !== undefined && now - lastSeen < windowMillis) {
      return false;
    }
    this.lastSeenAt.set(cardCode, now);
    return true;
  }
}

module.exports = { DebounceGuard };
