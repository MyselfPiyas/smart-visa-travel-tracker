import 'dotenv/config';
import app from './app.js';
import { disconnectDatabase, startDatabaseConnectionManager } from './config/database.js';
import { validateEnvironment } from './config/environment.js';

const port = Number(process.env.PORT) || 5000;

validateEnvironment();
const server = app.listen(port, () => console.log(`API server listening on port ${port}`));
const databaseManager = startDatabaseConnectionManager();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      try { await databaseManager.stop(); await disconnectDatabase(); process.exitCode = 0; }
      catch (error) { console.error('Database shutdown failed:', error?.name || 'Error'); process.exitCode = 1; }
    });
    server.closeIdleConnections?.();
  });
}
