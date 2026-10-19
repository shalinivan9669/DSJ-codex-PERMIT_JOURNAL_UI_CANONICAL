import type { ReadStream } from "node:fs";
import type { Response } from "express";

/** Own the descriptor even when a client disconnects during the preceding await. */
export function pipePrivateResponse(
  res: Response,
  stream: ReadStream,
  writeHeaders: () => void,
) {
  const close = () => stream.destroy();
  const failed = () => res.destroy();
  stream.once("error", failed);
  res.once("close", close);
  res.once("finish", close);
  stream.once("close", () => {
    res.removeListener("close", close);
    res.removeListener("finish", close);
  });
  if (res.destroyed || res.writableEnded) {
    close();
    return;
  }
  try {
    writeHeaders();
    if (res.destroyed || res.writableEnded) close();
    else stream.pipe(res);
  } catch (error) {
    close();
    throw error;
  }
}
