import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { createSmtpTransport } from '../services/notification-email.js';
import { createReminderScheduler } from '../services/reminder-scheduler.service.js';
import { createNotificationProcessor } from '../services/notification-processor.service.js';

function safeLogError(label, error) {
  console.error(label, error?.name || 'Error', error?.code || 'UNKNOWN');
}

export async function startReminderWorker({ scheduler = createReminderScheduler(), processor } = {}) {
  if (String(process.env.REMINDER_WORKER_ENABLED || 'true').toLowerCase() === 'false') {
    console.info('Reminder worker is disabled by configuration.');
    return { stop: async () => {} };
  }
  const connected = await connectDatabase();
  if (!connected) throw new Error('Reminder worker cannot start without MongoDB.');
  const { transport, from } = createSmtpTransport();
  try { await transport.verify(); }
  catch (error) { safeLogError('SMTP verification failed:', error); await disconnectDatabase(); throw new Error('Reminder worker SMTP verification failed.'); }

  const sender = processor || createNotificationProcessor({ transport, from });
  let scheduling = false;
  async function runScheduler() {
    if (scheduling) return;
    scheduling = true;
    try {
      const result = await scheduler.runOnce();
      if (result.created) console.info('Reminder schedule updated:', result.created);
    } catch (error) { safeLogError('Reminder scheduling cycle failed:', error); }
    finally { scheduling = false; }
  }
  async function runDelivery() {
    try {
      const result = await sender.processDue({ batchSize: Number(process.env.REMINDER_BATCH_SIZE) || 50 });
      if (result.sent || result.failed || result.retried) console.info('Reminder delivery cycle:', JSON.stringify(result));
    } catch (error) { safeLogError('Reminder delivery cycle failed:', error); }
  }

  await runScheduler();
  await runDelivery();
  const schedulerTimer = setInterval(runScheduler, Math.max(60000, Number(process.env.REMINDER_SCAN_INTERVAL_MS) || 15 * 60 * 1000));
  const deliveryTimer = setInterval(runDelivery, Math.max(10000, Number(process.env.REMINDER_POLL_INTERVAL_MS) || 60 * 1000));
  console.info('Persistent reminder worker started.');

  return {
    async stop() {
      clearInterval(schedulerTimer);
      clearInterval(deliveryTimer);
      if (typeof transport.close === 'function') transport.close();
      await disconnectDatabase();
    },
  };
}

