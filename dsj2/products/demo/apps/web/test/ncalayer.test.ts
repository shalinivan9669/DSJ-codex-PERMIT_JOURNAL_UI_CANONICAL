import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { signWithNCALayer } from "../lib/ncalayer";

// Transport fixtures only: no certificate or signature is claimed to be verified.
const cms = Buffer.from("synthetic CMS transport bytes ".repeat(8)).toString(
  "base64",
);

function transport(t: TestContext) {
  const descriptors = ["window", "WebSocket"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const sockets: FakeSocket[] = [];
  let timeout: (() => void) | undefined;
  let timerCleared = false;
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    sent: string[] = [];
    closed = false;
    throwOnSend = false;
    constructor(readonly url: string) {
      sockets.push(this);
    }
    send(value: string) {
      if (this.throwOnSend) throw new Error("closed transport");
      this.sent.push(value);
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
    message(value: unknown) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
  }
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeSocket,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback: () => void) {
        timeout = callback;
        return 1;
      },
      clearTimeout() {
        timerCleared = true;
      },
    },
  });
  t.after(() => {
    for (const [key, descriptor] of descriptors)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  });
  return {
    socket: () => sockets.at(-1)!,
    expire: () => timeout?.(),
    timerCleared: () => timerCleared,
  };
}

test("NCALayer requests detached signature-purpose CMS and retains default NCA trust chain", async (t) => {
  const channel = transport(t);
  const result = signWithNCALayer({
    dataBase64: "cGRm",
    iin: "000000000001",
    bin: "000000000002",
  });
  const socket = channel.socket();
  assert.equal(socket.url, "wss://127.0.0.1:13579/");
  socket.onopen?.();
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    module: "kz.gov.pki.knca.basics",
    method: "sign",
    args: {
      format: "cms",
      data: "cGRm",
      signingParams: { decode: true, encapsulate: false, digested: false },
      signerParams: {
        extKeyUsageOids: ["1.3.6.1.5.5.7.3.4"],
        iin: "000000000001",
        bin: "000000000002",
      },
      locale: "ru",
    },
  });
  socket.message({ result: { version: "1.4" } });
  assert.equal(socket.closed, false);
  socket.message({ status: true, body: { result: [cms] } });
  assert.equal(await result, cms);
  assert.equal(socket.closed, true);
  assert.equal(channel.timerCleared(), true);
});

test("line-wrapped CMS keeps the exact bytes and supports the documented response variants", async (t) => {
  const channel = transport(t);
  const wrapped = cms.match(/.{1,64}/g)!.join("\r\n");
  for (const response of [wrapped, [wrapped], { signatures: [wrapped] }]) {
    const result = signWithNCALayer({ dataBase64: "cGRm" });
    channel.socket().message({ status: true, body: { result: response } });
    const signature = await result;
    assert.equal(signature, cms);
    assert.deepEqual(
      Buffer.from(signature, "base64"),
      Buffer.from(wrapped, "base64"),
    );
  }
});

test("cancellation, multiple signatures and malformed responses cannot complete signing", async (t) => {
  const channel = transport(t);
  for (const response of [
    null,
    [],
    "invalid",
    { status: false },
    { status: true, body: { result: [cms, cms] } },
    { status: true, body: { result: `${cms} ` } },
  ]) {
    const result = signWithNCALayer({ dataBase64: "cGRm" });
    const rejected = assert.rejects(result);
    channel.socket().message(response);
    await rejected;
    assert.equal(channel.socket().closed, true);
  }
});

test("transport send failure and timeout reject promptly and release the connection", async (t) => {
  const channel = transport(t);
  for (const cause of ["send", "timeout", "error", "close"]) {
    const result = signWithNCALayer({ dataBase64: "cGRm" });
    const rejected = assert.rejects(result);
    const socket = channel.socket();
    if (cause === "send") {
      socket.throwOnSend = true;
      socket.onopen?.();
    } else if (cause === "timeout") channel.expire();
    else if (cause === "error") socket.onerror?.();
    else socket.onclose?.();
    await rejected;
    assert.equal(socket.closed, true);
    assert.equal(channel.timerCleared(), true);
  }
});
