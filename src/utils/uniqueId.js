// Generate a 15-digit numeric string similar in spirit to the PHP code
export function makeUniqueId() {
  const now = Date.now().toString(); // ms
  const rand = Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
  // Take last 6 of time + 9 random = 15 digits
  return (now.slice(-6) + rand).slice(0, 15);
}
