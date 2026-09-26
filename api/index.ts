import { Request, Response } from 'express';
import app from '../src/app';
import { initDatabase } from '../src/db/pool';

let initialized = false;
let initPromise: Promise<void> | null = null;

async function ensureDbInitialized() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = initDatabase()
      .then(() => {
        initialized = true;
      })
      .catch((err) => {
        initPromise = null;
        console.error('[Vercel] DB init failed:', err);
      });
  }
  await initPromise;
}

export default async function handler(req: Request, res: Response) {
  await ensureDbInitialized();
  return (app as any)(req, res);
}
