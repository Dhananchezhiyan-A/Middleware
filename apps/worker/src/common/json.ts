/** Casts a plain JS value into a Prisma JSON input column (type-level only). */
export function json(value: unknown): never {
  return value as never;
}

/** Reads a Prisma JSON column back into a typed shape. */
export function fromJson<T>(value: unknown): T {
  return value as T;
}
