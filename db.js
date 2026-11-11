/**
 * Serverless API Endpoint untuk Vercel (/api/db)
 * Menyimpan & menyinkronkan data Peminjaman (loans) dan Pengembalian (returns).
 *
 * Mendukung otomatis:
 * 1. Vercel KV / Upstash Redis (jika KV_REST_API_URL & KV_REST_API_TOKEN ada di Environment Variables Vercel)
 * 2. Firebase Realtime Database (jika FIREBASE_DB_URL ada di Environment Variables Vercel)
 * 3. Fallback /tmp (hanya untuk 1 container sementara jika belum ada database cloud yang dihubungkan)
 */
import fs from 'fs';
import path from 'path';

const TMP_FILE = path.join('/tmp', 'inventaris_db_v4.json');

const DEFAULT_DATA = {
  lastUpdated: 1,
  loans: [
    {
      id: 'item-1',
      tanggal: '2026-11-11',
      namaBarang: 'Proyektor Epson EB-X500',
      serialNumber: 'SN-EPS-88412',
      jumlahBarang: 1,
      peminjam: 'Budi Santoso',
      yangMenyerahkan: 'Rizky (Admin Logistik)'
    },
    {
      id: 'item-2',
      tanggal: '2026-11-11',
      namaBarang: 'Kabel Roll Industrial 15m',
      serialNumber: 'SN-KBL-10294',
      jumlahBarang: 3,
      peminjam: 'Siti Rahma',
      yangMenyerahkan: 'Rizky (Admin Logistik)'
    },
    {
      id: 'item-3',
      tanggal: '2026-11-10',
      namaBarang: 'Kamera Sony Alpha A6400',
      serialNumber: 'SN-SNY-55301',
      jumlahBarang: 1,
      peminjam: 'Andi Pratama',
      yangMenyerahkan: 'Dewi (Staf Inventaris)'
    },
    {
      id: 'item-4',
      tanggal: '2026-11-09',
      namaBarang: 'HT Motorola CP1660',
      serialNumber: 'SN-MTR-77401',
      jumlahBarang: 6,
      peminjam: 'Panitia Seminar',
      yangMenyerahkan: 'Dewi (Staf Inventaris)'
    }
  ],
  returns: [
    {
      id: 'ret-1',
      loanId: 'item-0',
      tanggalPinjam: '2026-11-08',
      tanggalKembali: '2026-11-10',
      namaBarang: 'Microphone Wireless Shure',
      serialNumber: 'SN-SHR-33190',
      jumlahBarang: 2,
      peminjam: 'Dian Kusuma',
      yangMenyerahkanPinjam: 'Rizky (Admin Logistik)',
      yangMenyerahkanKembali: 'Dian Kusuma',
      catatan: 'Kondisi lengkap beserta koper & baterai cadangan'
    }
  ]
};

function sanitizeRoom(raw) {
  return String(raw || 'INVENTARIS-BERSAMA')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-') || 'INVENTARIS-BERSAMA';
}

async function readDb(room) {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const firebaseUrl = process.env.FIREBASE_DB_URL;
  const keyName = `inventaris_v4_${room}`;

  // 1. Vercel KV / Upstash Redis
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/${keyName}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
        cache: 'no-store'
      });
      const json = await res.json();
      if (json && json.result) {
        const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
        return { ...parsed, storageMode: 'vercel_kv' };
      }
      return { ...DEFAULT_DATA, storageMode: 'vercel_kv' };
    } catch (e) {}
  }

  // 2. Firebase Realtime Database
  if (firebaseUrl) {
    try {
      const res = await fetch(firebaseUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && (Array.isArray(data.loans) || Array.isArray(data.returns))) {
          return { ...data, storageMode: 'firebase' };
        }
        return { ...DEFAULT_DATA, storageMode: 'firebase' };
      }
    } catch (e) {}
  }

  // 3. Fallback /tmp (hanya di 1 container)
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...parsed, storageMode: 'ephemeral_tmp' };
    }
  } catch (e) {}

  return { ...DEFAULT_DATA, storageMode: 'ephemeral_tmp' };
}

async function writeDb(room, payload) {
  const safePayload = {
    room,
    lastUpdated: Number(payload.lastUpdated) || Date.now(),
    loans: Array.isArray(payload.loans) ? payload.loans : [],
    returns: Array.isArray(payload.returns) ? payload.returns : []
  };

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const firebaseUrl = process.env.FIREBASE_DB_URL;
  const keyName = `inventaris_v4_${room}`;
  let storageMode = 'ephemeral_tmp';

  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/set/${keyName}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(safePayload))
      });
      storageMode = 'vercel_kv';
    } catch (e) {}
  }

  if (firebaseUrl) {
    try {
      await fetch(firebaseUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safePayload)
      });
      storageMode = 'firebase';
    } catch (e) {}
  }

  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(safePayload, null, 2), 'utf-8');
  } catch (e) {}

  return { ...safePayload, storageMode };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const room = sanitizeRoom(req.query && req.query.room);

  if (req.method === 'GET') {
    const data = await readDb(room);
    return res.status(200).json(data);
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const targetRoom = sanitizeRoom(body.room || room);
    const updated = await writeDb(targetRoom, body);
    return res.status(200).json({ status: 'ok', ...updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
