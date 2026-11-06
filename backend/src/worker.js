import 'dotenv/config';
import { startReminderWorker } from './jobs/reminder-worker.js';

let worker;
try {
  worker = await startReminderWorker();
} catch (error) {
  console.error('Reminder worker could not start:', error?.name || 'Error', error?.code || 'CONFIGURATION_ERROR');
  process.exitCode = 1;
}

if (worker) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => worker.stop().finally(() => process.exit(0)));
  }
}
