import mongoose from 'mongoose';

let listenersRegistered = false;

/** Connect only when configured; the API can still serve its health route without Atlas. */
export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    console.warn('MongoDB is not configured; database-backed features are unavailable.');
    return false;
  }

  if (!listenersRegistered) {
    mongoose.connection.on('connected', () => console.info('MongoDB connection established.'));
    mongoose.connection.on('disconnected', () => console.warn('MongoDB connection lost.'));
    mongoose.connection.on('error', (error) => console.error('MongoDB connection error:', error.name || 'Error'));
    listenersRegistered = true;
  }

  try {
    if (mongoose.connection.readyState === 1) return true;
    if (mongoose.connection.readyState === 2) return false;
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 5000,
    });
    return true;
  } catch (error) {
    // Never log a connection string or driver message; either could contain credentials.
    console.error('Could not connect to MongoDB:', error.name || 'ConnectionError');
    return false;
  }
}

/**
 * Keep retrying after an initial Atlas outage, and reconnect if the connection
 * is later lost. Mongoose's driver can recover an established connection on
 * its own; this manager covers failures before the first successful connect.
 */
export function startDatabaseConnectionManager({
  initialDelayMs = 0,
  minDelayMs = 2000,
  maxDelayMs = 30000,
  connectedCheckMs = 60000,
} = {}) {
  let stopped = false;
  let timer;
  let failures = 0;
  let activeAttempt;

  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeout(checkConnection, delay);
    timer.unref?.();
  };

  const checkConnection = async () => {
    if (stopped) return;
    if (!process.env.MONGODB_URI) return;

    const state = mongoose.connection.readyState;
    if (state === 1) {
      failures = 0;
      schedule(connectedCheckMs);
      return;
    }
    if (state === 2 || state === 3) {
      schedule(minDelayMs);
      return;
    }

    activeAttempt = connectDatabase();
    const connected = await activeAttempt;
    activeAttempt = undefined;
    if (stopped) return;

    if (connected) {
      failures = 0;
      schedule(connectedCheckMs);
      return;
    }

    failures += 1;
    const backoff = Math.min(maxDelayMs, minDelayMs * (2 ** Math.min(failures - 1, 5)));
    const jittered = Math.round(backoff * (0.8 + Math.random() * 0.4));
    schedule(jittered);
  };

  schedule(initialDelayMs);

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      if (activeAttempt) await activeAttempt;
    },
  };
}

export function getDatabaseStatus() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'disconnected';
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
