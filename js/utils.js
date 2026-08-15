const formatterCache = new Map();

export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getNumberFormatter(minimumFractionDigits, maximumFractionDigits) {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;

  if (!formatterCache.has(key)) {
    formatterCache.set(
      key,
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits,
        maximumFractionDigits,
      }),
    );
  }

  return formatterCache.get(key);
}

export function formatPrice(value, pricePrecision) {
  const number = toFiniteNumber(value);
  if (number === null) return "—";

  const fallbackPrecision =
    Math.abs(number) >= 1000
      ? 1
      : Math.abs(number) >= 1
        ? 4
        : Math.abs(number) >= 0.01
          ? 6
          : 8;
  const maximumFractionDigits = Number.isInteger(pricePrecision)
    ? Math.min(Math.max(pricePrecision, 0), 12)
    : fallbackPrecision;
  const minimumFractionDigits =
    Math.abs(number) >= 1000
      ? Math.min(maximumFractionDigits, 1)
      : Math.abs(number) >= 1
        ? Math.min(maximumFractionDigits, 2)
        : 0;

  return getNumberFormatter(
    minimumFractionDigits,
    maximumFractionDigits,
  ).format(number);
}

export function formatPercent(value) {
  const number = toFiniteNumber(value);
  if (number === null) return "—";

  const sign = number > 0 ? "+" : "";
  return `${sign}${getNumberFormatter(2, 2).format(number)}%`;
}

export function formatCompact(value) {
  const number = toFiniteNumber(value);
  if (number === null) return "—";

  const absolute = Math.abs(number);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];

  for (const [threshold, suffix] of units) {
    if (absolute >= threshold) {
      const compactValue = number / threshold;
      const digits = Math.abs(compactValue) >= 100 ? 0 : 1;
      return `${compactValue.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
    }
  }

  return getNumberFormatter(0, absolute < 10 ? 2 : 0).format(number);
}

export function formatFullNumber(value) {
  const number = toFiniteNumber(value);
  if (number === null) return "";
  return getNumberFormatter(0, 8).format(number);
}

export function formatClock(timestamp) {
  const value = toFiniteNumber(timestamp);
  if (value === null) return "—";

  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function chunk(items, size) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError("Chunk size must be a positive integer.");
  }

  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `bingx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
