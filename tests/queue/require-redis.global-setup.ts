import net from "node:net";

/**
 * Global gate for the queue test suite.
 *
 * These tests exercise REAL Redis + BullMQ — never mocks. If Redis is not
 * reachable the entire run fails LOUDLY (it does not silently pass or skip).
 *
 * Status without Redis: BLOCKED — Redis unavailable.
 */
export default async function setup(): Promise<void> {
  const host = process.env.REDIS_HOST ?? "localhost";
  const port = Number(process.env.REDIS_PORT ?? 6379);

  const reachable = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3_000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

  if (!reachable) {
    const message =
      `BLOCKED — Redis unavailable at ${host}:${port}.\n` +
      `Queue tests require a REAL Redis server (Docker is not required; Memurai or a Windows Redis build is fine).\n` +
      `Install/start Redis, then re-run: pnpm test:queue`;
    console.error(message);
    throw new Error(message);
  }

  console.log(`Redis reachable at ${host}:${port} — running real queue tests.`);
}
