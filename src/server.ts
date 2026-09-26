import app from './app';
import { initDatabase } from './db/pool';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();

    const port = Number(PORT);
    app.listen(port, '0.0.0.0', () => {
      console.log(`===============================================`);
      console.log(` DecodeNow Dynamic QR Backend is running!`);
      console.log(` Port:    http://localhost:${port}`);
      console.log(` Health:  http://localhost:${port}/api/health`);
      console.log(` Base:    ${process.env.BASE_URL || `http://localhost:${port}`}`);
      console.log(`===============================================`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
