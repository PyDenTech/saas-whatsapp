let ioRef = null;

export function registerIo(io) {
  ioRef = io;
}

export function emitTenantEvent(tenantId, eventName, payload) {
  if (!ioRef || !tenantId) return;
  ioRef.to(`tenant:${tenantId}`).emit(eventName, payload);
}
