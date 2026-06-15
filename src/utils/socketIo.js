/** Shared Socket.io instance for workers and services outside HTTP handlers. */
let ioInstance = null;

export function setSocketIo(io) {
  ioInstance = io;
}

export function getSocketIo() {
  return ioInstance;
}
