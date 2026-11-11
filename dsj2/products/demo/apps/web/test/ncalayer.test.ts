import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { signManyWithNCALayer, signWithNCALayer } from "../lib/ncalayer";

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
    socketCount: () => sockets.length,
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

test("NCALayer CMS PEM responses preserve the signed bytes in every supported envelope", async (t) => {
  const channel = transport(t);
  for (const newline of ["\n", "\r\n", ""]) {
    const wrapped = cms.match(/.{1,64}/g)!.join(newline);
    const pem = `-----BEGIN CMS-----${newline}${wrapped}${newline}-----END CMS-----${newline}`;
    for (const response of [pem, [pem], { signatures: [pem] }]) {
      const result = signWithNCALayer({ dataBase64: "cGRm" });
      channel.socket().message({ status: true, body: { result: response } });
      const signature = await result;
      assert.equal(signature, cms);
      assert.deepEqual(
        Buffer.from(signature, "base64"),
        Buffer.from(cms, "base64"),
      );
    }
  }
});

test("incomplete, mismatched and multiple PEM envelopes cannot complete signing", async (t) => {
  const channel = transport(t);
  const pem = `-----BEGIN CMS-----\n${cms}\n-----END CMS-----`;
  for (const signature of [
    `-----BEGIN CMS-----\n${cms}`,
    `${cms}\n-----END CMS-----`,
    pem.replace("END CMS", "END CERTIFICATE"),
    pem.replaceAll("CMS", "CERTIFICATE"),
    `${pem}\n${pem}`,
    `unexpected\n${pem}`,
    `${pem}\nunexpected`,
    "-----BEGIN CMS-----\n\n-----END CMS-----",
    pem.replace(cms, `${cms}!`),
  ]) {
    const result = signWithNCALayer({ dataBase64: "cGRm" });
    const rejected = assert.rejects(result);
    channel.socket().message({ status: true, body: { result: signature } });
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

test("one NCALayer array request retains document and CMS order, signer filters, and exact bytes", async (t) => {
  const channel = transport(t);
  const documents = ["cGRmLTI=", "cGRmLTE=", "cGRmLTM="];
  const sentDocuments = [...documents];
  const signatures = ["second", "first", "third"].map((label) =>
    Buffer.from(`synthetic CMS ${label} `.repeat(8)).toString("base64"),
  );
  const result = signManyWithNCALayer({
    dataBase64: documents,
    iin: "000000000001",
    bin: "000000000002",
  });
  documents.reverse();
  documents.push("must-not-be-added-after-confirmation");
  const socket = channel.socket();
  socket.onopen?.();
  assert.equal(channel.socketCount(), 1);
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    module: "kz.gov.pki.knca.basics",
    method: "sign",
    args: {
      format: "cms",
      data: sentDocuments,
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
  socket.message({
    status: true,
    body: {
      result: [
        signatures[0],
        `-----BEGIN CMS-----\n${signatures[1]}\n-----END CMS-----`,
        signatures[2].match(/.{1,64}/g)!.join("\r\n"),
      ],
    },
  });
  const actual = await result;
  assert.deepEqual(actual, signatures);
  for (let i = 0; i < signatures.length; i++)
    assert.deepEqual(
      Buffer.from(actual[i], "base64"),
      Buffer.from(signatures[i], "base64"),
    );
  assert.equal(socket.closed, true);
  assert.equal(channel.timerCleared(), true);
});

test("batch accepts direct and certificate envelopes, including a one-document array", async (t) => {
  const channel = transport(t);
  for (const size of [1, 2]) {
    const expected = Array.from({ length: size }, (_, i) =>
      Buffer.from(`synthetic CMS ${i} `.repeat(8)).toString("base64"),
    );
    for (const response of [
      expected,
      { signatures: expected, certificate: "unused" },
    ]) {
      const result = signManyWithNCALayer({
        dataBase64: Array.from({ length: size }, () => "cGRm"),
      });
      const socket = channel.socket();
      socket.onopen?.();
      const request = JSON.parse(socket.sent[0]);
      assert.equal(Array.isArray(request.args.data), true);
      assert.deepEqual(request.args.signerParams, {
        extKeyUsageOids: ["1.3.6.1.5.5.7.3.4"],
      });
      socket.message({ status: true, body: { result: response } });
      assert.deepEqual(await result, expected);
    }
  }
});

test("batch rejects incomplete, oversized or malformed CMS sets without returning partial results or fallback calls", async (t) => {
  const channel = transport(t);
  const pem = `-----BEGIN CMS-----\n${cms}\n-----END CMS-----`;
  for (const response of [
    [],
    [cms],
    [cms, cms, cms],
    cms,
    { signatures: cms },
    [cms, null],
    [cms, "invalid"],
    [cms, [cms]],
    [cms, `${pem}\n${pem}`],
    { signatures: [cms, `${cms} `] },
  ]) {
    const before = channel.socketCount();
    const result = signManyWithNCALayer({
      dataBase64: ["cGRmLTE=", "cGRmLTI="],
    });
    const rejected = assert.rejects(result, /полный набор подписей/);
    const socket = channel.socket();
    socket.onopen?.();
    socket.message({ status: true, body: { result: response } });
    await rejected;
    socket.message({ status: true, body: { result: [cms, cms] } });
    assert.equal(channel.socketCount(), before + 1);
    assert.equal(socket.sent.length, 1);
    assert.equal(socket.closed, true);
    assert.equal(channel.timerCleared(), true);
  }
});

test("empty, sparse and non-string batch inputs fail before opening NCALayer", async (t) => {
  const channel = transport(t);
  for (const dataBase64 of [
    [],
    [""],
    Array<string>(2),
    ["cGRm", undefined],
    "cGRm",
  ]) {
    await assert.rejects(
      signManyWithNCALayer({ dataBase64: dataBase64 as string[] }),
      /Выберите документы/,
    );
  }
  assert.equal(channel.socketCount(), 0);
});

test("batch cancellation and transport failures release one connection and never start another signing prompt", async (t) => {
  const channel = transport(t);
  for (const cause of ["cancel", "send", "timeout", "error", "close"]) {
    const before = channel.socketCount();
    const result = signManyWithNCALayer({
      dataBase64: ["cGRmLTE=", "cGRmLTI="],
    });
    const rejected = assert.rejects(result);
    const socket = channel.socket();
    if (cause === "cancel") {
      socket.onopen?.();
      socket.message({ status: false });
    } else if (cause === "send") {
      socket.throwOnSend = true;
      socket.onopen?.();
    } else if (cause === "timeout") channel.expire();
    else if (cause === "error") socket.onerror?.();
    else socket.onclose?.();
    await rejected;
    const sentBeforeLateEvents = socket.sent.length;
    socket.onopen?.();
    socket.message({ status: true, body: { result: [cms, cms] } });
    assert.equal(socket.sent.length, sentBeforeLateEvents);
    assert.equal(channel.socketCount(), before + 1);
    assert.equal(socket.closed, true);
    assert.equal(channel.timerCleared(), true);
  }
});
