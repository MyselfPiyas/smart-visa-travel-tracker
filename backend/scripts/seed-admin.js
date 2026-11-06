import 'dotenv/config';
import bcrypt from 'bcryptjs';
import User from '../src/models/User.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';

const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

try {
  if (!ADMIN_NAME?.trim() || !ADMIN_EMAIL?.trim() || !ADMIN_PASSWORD || Buffer.byteLength(ADMIN_PASSWORD, 'utf8') < 12 || Buffer.byteLength(ADMIN_PASSWORD, 'utf8') > 72) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of 12 to 72 UTF-8 bytes in the environment.');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required to create the initial administrator.');
  await connectDatabase();
  if (User.db.readyState !== 1) throw new Error('MongoDB is unavailable; the administrator was not created.');
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) throw new Error('An account with this email already exists; no changes were made.');
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, Math.min(14, Math.max(10, Number(process.env.BCRYPT_SALT_ROUNDS) || 12)));
  await User.create({ name: ADMIN_NAME.trim(), email, passwordHash, role: 'admin', accountStatus: 'active' });
  console.info('Initial administrator created. Remove the ADMIN_PASSWORD environment variable now.');
} catch (error) {
  console.error('Administrator seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
