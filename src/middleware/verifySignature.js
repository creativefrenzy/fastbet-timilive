import crypto from 'crypto';

export function verifySignature({ signature_nonce, timestamp, signature }) {
  const key = process.env.APP_KEY || '';
  const generated = crypto
    .createHash('md5')
    .update(String(signature_nonce ?? '') + String(key) + String(timestamp ?? ''))
    .digest('hex');
  return generated === String(signature || '');
}
