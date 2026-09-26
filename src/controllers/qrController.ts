import { Request, Response, NextFunction } from 'express';
import {
  createDynamicQR,
  getByShortCode,
  updateDestinationUrl,
  disableDynamicQR,
  handleRedirect,
} from '../services/qrService';

export async function createQR(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { destinationUrl } = req.body;

    if (!destinationUrl || typeof destinationUrl !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Field "destinationUrl" is required and must be a valid URL string.',
      });
      return;
    }

    const created = await createDynamicQR(destinationUrl);

    res.status(201).json({
      success: true,
      data: created,
    });
  } catch (err: any) {
    if (err.message && err.message.includes('Invalid destination URL')) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    next(err);
  }
}

export async function getQR(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { shortCode } = req.params;

    if (!shortCode) {
      res.status(400).json({ success: false, message: 'Short code is required.' });
      return;
    }

    const record = await getByShortCode(shortCode);

    if (!record) {
      res.status(404).json({
        success: false,
        message: `Dynamic QR code "${shortCode}" was not found.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: record,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateQR(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { shortCode } = req.params;
    const { destinationUrl } = req.body;

    if (!destinationUrl || typeof destinationUrl !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Field "destinationUrl" is required and must be a valid URL string.',
      });
      return;
    }

    const updated = await updateDestinationUrl(shortCode, destinationUrl);

    if (!updated) {
      res.status(404).json({
        success: false,
        message: `Dynamic QR code "${shortCode}" was not found.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err: any) {
    if (err.message && err.message.includes('Invalid destination URL')) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    next(err);
  }
}

export async function disableQR(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { shortCode } = req.params;

    const disabled = await disableDynamicQR(shortCode);

    if (!disabled) {
      res.status(404).json({
        success: false,
        message: `Dynamic QR code "${shortCode}" was not found.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Dynamic QR code disabled successfully.',
      data: disabled,
    });
  } catch (err) {
    next(err);
  }
}

export async function redirectQR(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { shortCode } = req.params;

    const result = await handleRedirect(shortCode);

    if (result.status === 'NOT_FOUND') {
      res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>DecodeNow - QR Not Found</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #F8F9FA; color: #222; text-align: center; }
            .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; margin: 1rem; }
            h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #d32f2f; }
            p { color: #666; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>QR Code Not Found</h1>
            <p>The Dynamic QR code <strong>${escapeHtml(shortCode)}</strong> does not exist or has expired.</p>
          </div>
        </body>
        </html>
      `);
      return;
    }

    if (result.status === 'DISABLED') {
      res.status(410).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>DecodeNow - QR Disabled</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #F8F9FA; color: #222; text-align: center; }
            .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; margin: 1rem; }
            h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #f57c00; }
            p { color: #666; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>QR Code Disabled</h1>
            <p>This Dynamic QR code has been disabled by its owner.</p>
          </div>
        </body>
        </html>
      `);
      return;
    }

    // HTTP 302 Found redirect
    res.redirect(302, result.destinationUrl);
  } catch (err) {
    next(err);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
