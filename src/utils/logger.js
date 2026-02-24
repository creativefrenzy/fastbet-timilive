import fs from 'fs';
import path from 'path';

const LOG_FILE = path.resolve(process.cwd(), 'logs.txt');

export function appendRequestLog(payload) {
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `\n${when} ${JSON.stringify(payload)}`;
  fs.appendFileSync(LOG_FILE, line);
}
