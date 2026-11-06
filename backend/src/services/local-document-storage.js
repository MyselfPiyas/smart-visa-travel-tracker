import 'dotenv/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';

export const ALLOWED_DOCUMENT_FILES = Object.freeze({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
});

const ENCRYPTED_FILE_MAGIC = Buffer.from('SVTDOC01');
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

function getEncryptionKey(value = process.env.DOCUMENT_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) {
    const error = new Error('Private document storage encryption is not configured.');
    error.status = 503;
    throw error;
  }
  return Buffer.from(value, 'hex');
}

function encryptFileContents(plaintext, key) {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ENCRYPTED_FILE_MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

function decryptFileContents(envelope, key) {
  const headerLength = ENCRYPTED_FILE_MAGIC.length + GCM_NONCE_BYTES + GCM_TAG_BYTES;
  if (envelope.length < headerLength || !envelope.subarray(0, ENCRYPTED_FILE_MAGIC.length).equals(ENCRYPTED_FILE_MAGIC)) {
    const error = new Error('Document file could not be opened.');
    error.status = 500;
    throw error;
  }
  const nonceStart = ENCRYPTED_FILE_MAGIC.length;
  const tagStart = nonceStart + GCM_NONCE_BYTES;
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(nonceStart, tagStart));
  decipher.setAuthTag(envelope.subarray(tagStart, headerLength));
  try {
    return Buffer.concat([decipher.update(envelope.subarray(headerLength)), decipher.final()]);
  } catch {
    const error = new Error('Document file could not be opened.');
    error.status = 500;
    throw error;
  }
}

export function getStorageSettings(env = process.env) {
  const maxFileSizeBytes = Math.min(50, Math.max(1, Number(env.DOCUMENT_MAX_FILE_SIZE_MB) || 10)) * 1024 * 1024;
  const maxFiles = Math.min(5, Math.max(1, Number(env.DOCUMENT_MAX_FILES_PER_DOCUMENT) || 5));
  return {
    provider: env.DOCUMENT_STORAGE_PROVIDER || 'local',
    rootDir: path.resolve(process.cwd(), env.DOCUMENT_LOCAL_STORAGE_PATH || './private_uploads'),
    maxFileSizeBytes,
    maxFiles,
  };
}

function safeKeyPath(rootDir, objectKey) {
  if (typeof objectKey !== 'string' || !/^[a-f\d-]{36}\.(pdf|png|jpe?g)$/i.test(objectKey)) {
    const error = new Error('Document file not found.');
    error.status = 404;
    throw error;
  }
  const root = path.resolve(rootDir);
  const target = path.resolve(root, objectKey);
  if (path.dirname(target) !== root) {
    const error = new Error('Document file not found.');
    error.status = 404;
    throw error;
  }
  return target;
}

function matchesFileSignature(extension, bytes) {
  if (extension === '.pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

export function createLocalDocumentStorage({ rootDir = getStorageSettings().rootDir, maxFiles = getStorageSettings().maxFiles, encryptionKey = process.env.DOCUMENT_ENCRYPTION_KEY } = {}) {
  const root = path.resolve(rootDir);
  return {
    provider: 'private_local',
    rootDir: root,
    maxFiles,
    multerStorage() {
      return multer.diskStorage({
        destination(_req, _file, callback) {
          mkdir(root, { recursive: true, mode: 0o700 }).then(() => callback(null, root), callback);
        },
        filename(_req, file, callback) {
          const extension = path.extname(file.originalname).toLowerCase();
          callback(null, `${randomUUID()}${extension}`);
        },
      });
    },
    async inspectUpload(file) {
      const extension = path.extname(file.filename).toLowerCase();
      const handle = await open(safeKeyPath(root, file.filename), 'r');
      try {
        const sample = Buffer.alloc(8);
        const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
        if (!matchesFileSignature(extension, sample.subarray(0, bytesRead))) {
          const error = new Error('The uploaded file content does not match an allowed document type.');
          error.status = 400;
          throw error;
        }
        const hash = createHash('sha256');
        const stream = createReadStream(safeKeyPath(root, file.filename));
        for await (const chunk of stream) hash.update(chunk);
        const checksumSha256 = hash.digest('hex');
        const key = getEncryptionKey(encryptionKey);
        const filePath = safeKeyPath(root, file.filename);
        const encryptedPath = `${filePath}.${randomUUID()}.encrypted`;
        const plaintextPath = `${filePath}.${randomUUID()}.plaintext`;
        const envelope = encryptFileContents(await readFile(filePath), key);
        let plaintextMoved = false;
        try {
          await writeFile(encryptedPath, envelope, { flag: 'wx', mode: 0o600 });
          await rename(filePath, plaintextPath);
          plaintextMoved = true;
          await rename(encryptedPath, filePath);
          plaintextMoved = false;
        } catch (error) {
          if (plaintextMoved) await rename(plaintextPath, filePath).catch(() => {});
          throw error;
        } finally {
          await rm(encryptedPath, { force: true }).catch(() => {});
        }
        await rm(plaintextPath, { force: true });
        return { checksumSha256 };
      } finally {
        await handle.close();
      }
    },
    createReadStream(objectKey) {
      const filePath = safeKeyPath(root, objectKey);
      return Readable.from((async function* () {
        const envelope = await readFile(filePath);
        yield decryptFileContents(envelope, getEncryptionKey(encryptionKey));
      })());
    },
    async remove(objectKey) {
      await rm(safeKeyPath(root, objectKey), { force: true });
    },
    async prepareDelete(objectKeys) {
      const staged = [];
      try {
        for (const objectKey of objectKeys) {
          const source = safeKeyPath(root, objectKey);
          const quarantine = `${source}.${randomUUID()}.deleting`;
          try { await rename(source, quarantine); staged.push({ source, quarantine }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      } catch (error) {
        for (const item of staged.reverse()) await rename(item.quarantine, item.source).catch(() => {});
        throw error;
      }
      return {
        async rollback() {
          for (const item of [...staged].reverse()) await rename(item.quarantine, item.source);
        },
        async commit() {
          await Promise.all(staged.map((item) => rm(item.quarantine, { force: true })));
        },
      };
    },
  };
}

export function createDocumentUploadMiddleware({ storage = createLocalDocumentStorage(), maxFileSizeBytes = getStorageSettings().maxFileSizeBytes, maxFiles = getStorageSettings().maxFiles } = {}) {
  const parser = multer({
    storage: storage.multerStorage(),
    limits: { fileSize: maxFileSizeBytes, files: maxFiles, fields: 0, parts: maxFiles },
    fileFilter(_req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_DOCUMENT_FILES[extension] || ALLOWED_DOCUMENT_FILES[extension] !== file.mimetype.toLowerCase()) {
        const error = new Error('Only matching PDF, JPEG, and PNG document files are allowed.');
        error.status = 400;
        return callback(error);
      }
      return callback(null, true);
    },
  }).array('files', maxFiles);

  return (req, res, next) => parser(req, res, async (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      error.status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      error.message = error.code === 'LIMIT_FILE_SIZE'
        ? `Each file must be no larger than ${Math.ceil(maxFileSizeBytes / (1024 * 1024))} MB.`
        : error.code === 'LIMIT_FILE_COUNT'
          ? `Upload no more than ${maxFiles} files at once.`
          : 'The uploaded files could not be accepted.';
    }
    // Multer may have written earlier files before a later part fails. Remove
    // those partial uploads so rejected requests do not leave orphaned files.
    await Promise.allSettled((req.files || []).map((file) => storage.remove(file.filename)));
    return next(error);
  });
}

export function createConfiguredDocumentStorage(env = process.env) {
  const settings = getStorageSettings(env);
  if (settings.provider !== 'local') {
    throw new Error(`Document storage provider "${settings.provider}" has no adapter configured. Use "local" until a private cloud adapter is installed.`);
  }
  return createLocalDocumentStorage({ rootDir: settings.rootDir, maxFiles: settings.maxFiles });
}

export const localDocumentStorage = createConfiguredDocumentStorage();
export const documentUploadMiddleware = createDocumentUploadMiddleware({ storage: localDocumentStorage });
