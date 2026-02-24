// src/utils/localDateTime.js

/**
 * Helper functions for local (Asia/Kolkata) date and time formatting.
 */

const getParts = (options = {}) => {
  const date = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    ...options,
  }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
};

export const nowStrLocal = () => {
  const map = getParts({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
};

export const todayStrLocal = () => {
  const map = getParts({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${map.year}-${map.month}-${map.day}`;
};

export const dayYYYYMMDDLocal = () => {
  const map = getParts({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${map.year}${map.month}${map.day}`;
};
