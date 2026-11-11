import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCmsSignerIdentity } from "../apps/api/src/signature-display-metadata";
import { localMockVerification } from "../apps/api/src/local-signing-mock";

// Real detached CMS over a synthetic payload, with an unrelated certificate too.
// Test-only RSA keys were generated in memory and were never saved in the repo.
const fixture = Buffer.from(
  readFileSync(
    new URL(
      "./fixtures/signature-display-metadata.p7s.base64",
      import.meta.url,
    ),
    "utf8",
  ),
  "base64",
);
type Node = {
  tag: number;
  data?: Buffer;
  children?: Node[];
  indefinite?: boolean;
};

// Fixture surgery lets tests change the certificate ordering, ASN.1 string type,
// and BER wrappers without storing invalid or misleading production examples.
function fixtureTree() {
  function parse(start: number): [Node, number] {
    let cursor = start + 2;
    let length = fixture[start + 1];
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let index = 0; index < count; index++)
        length = length * 256 + fixture[cursor++];
    }
    const end = cursor + length;
    const node: Node = { tag: fixture[start] };
    if (node.tag & 0x20) {
      node.children = [];
      while (cursor < end) {
        const [child, next] = parse(cursor);
        node.children.push(child);
        cursor = next;
      }
    } else node.data = fixture.subarray(cursor, end);
    return [node, end];
  }
  return parse(0)[0];
}
function encode(node: Node): Buffer {
  const data = node.children
    ? Buffer.concat(node.children.map(encode))
    : node.data!;
  if (node.indefinite)
    return Buffer.concat([
      Buffer.from([node.tag, 0x80]),
      data,
      Buffer.from([0, 0]),
    ]);
  const bytes: number[] = [];
  for (let value = data.length; value > 0; value = Math.floor(value / 256))
    bytes.unshift(value % 256);
  const length =
    data.length < 128 ? [data.length] : [0x80 | bytes.length, ...bytes];
  return Buffer.concat([Buffer.from([node.tag, ...length]), data]);
}
function parts(tree: Node) {
  const data = tree.children![1].children![0];
  const certificates = data.children![3];
  const signerInfos = data.children!.at(-1)!;
  const signer = certificates.children!.find(
    (certificate) =>
      certificate.children![0].children![1].data?.toString("hex") ===
      "0123456789",
  )!;
  const subject = signer.children![0].children![5];
  const cn = subject.children![0].children![0].children![1];
  return { data, certificates, signerInfos, signer, subject, cn };
}

test("CMS display reads the actual signer certificate, never a synthetic role binding", () => {
  const identity = readCmsSignerIdentity(fixture);
  assert.equal(identity?.displayName, "Синтетический Подписант");
  assert.equal(identity?.certificateSerial, "0123456789");
  assert.match(identity!.certificateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(identity?.source, "CMS_SIGNER_CERTIFICATE");
  assert.equal(identity?.identityVerified, false);
  const receipt = localMockVerification(fixture.toString("base64"), {
    documentSha256: "a".repeat(64),
    iin: "000000000001",
    bin: null,
  });
  assert.equal(receipt.valid, false);
  assert.equal(
    receipt.identitySource,
    "SYNTHETIC_ROLE_BINDING_NOT_CERTIFICATE",
  );
  assert.deepEqual(receipt.certificateDisplayIdentity, identity);
  assert.equal(receipt.signerIin, "000000000001");
});

test("certificate ordering cannot replace the signer with another certificate owner", () => {
  const tree = fixtureTree();
  const { certificates, signer } = parts(tree);
  certificates.children!.reverse();
  assert.deepEqual(
    readCmsSignerIdentity(encode(tree)),
    readCmsSignerIdentity(fixture),
  );
  certificates.children = certificates.children!.filter(
    (entry) => entry !== signer,
  );
  assert.equal(readCmsSignerIdentity(encode(tree)), null);
});

test("missing, duplicate, mismatched or multiple signer identities are unavailable", () => {
  for (const change of [
    (tree: Node) => {
      const p = parts(tree);
      p.certificates.children!.push(p.signer);
    },
    (tree: Node) => {
      const p = parts(tree);
      p.signerInfos.children!.push(p.signerInfos.children![0]);
    },
    (tree: Node) => {
      parts(tree).signerInfos.children = [];
    },
    (tree: Node) => {
      parts(tree).signerInfos.children![0].children![1].children![1].data =
        Buffer.from([0x12]);
    },
    (tree: Node) => {
      parts(tree).signerInfos.children![0].children![1] = {
        tag: 0x80,
        data: Buffer.alloc(20, 1),
      };
    },
  ]) {
    const tree = fixtureTree();
    change(tree);
    assert.equal(readCmsSignerIdentity(encode(tree)), null);
  }
});

test("NCALayer BER indefinite wrappers preserve the same display identity", () => {
  const tree = fixtureTree();
  tree.indefinite = true;
  tree.children![1].indefinite = true;
  parts(tree).data.indefinite = true;
  assert.deepEqual(
    readCmsSignerIdentity(encode(tree)),
    readCmsSignerIdentity(fixture),
  );
});

test("BMP names are readable metadata even though modified certificate signatures are not verified", () => {
  const tree = fixtureTree();
  const cn = parts(tree).cn;
  cn.tag = 0x1e;
  cn.data = Buffer.from("Сынақ Қол қоюшы", "utf16le").swap16();
  const identity = readCmsSignerIdentity(encode(tree));
  assert.equal(identity?.displayName, "Сынақ Қол қоюшы");
  assert.equal(identity?.identityVerified, false);
});

test("display parsing does not require the local crypto provider to support the certificate's key algorithm", () => {
  const tree = fixtureTree();
  const subjectPublicKey = parts(tree).signer.children![0].children![6];
  // GOST R 34.10-2012 OID. This mutation is intentionally not a valid signature
  // or key: only the certificate subject is displayed, never authenticated.
  subjectPublicKey.children![0].children![0].data = Buffer.from(
    "2a85030701010101",
    "hex",
  );
  const identity = readCmsSignerIdentity(encode(tree));
  assert.equal(identity?.displayName, "Синтетический Подписант");
  assert.equal(identity?.identityVerified, false);
});

test("certificate surname and given name are used only when CN is absent", () => {
  const tree = fixtureTree();
  const { subject } = parts(tree);
  const attribute = (oid: string, value: string): Node => ({
    tag: 0x31,
    children: [
      {
        tag: 0x30,
        children: [
          { tag: 6, data: Buffer.from(oid, "hex") },
          { tag: 0x0c, data: Buffer.from(value) },
        ],
      },
    ],
  });
  subject.children = [
    attribute("550404", "Синтетический"),
    attribute("55042a", "Подписант"),
  ];
  assert.equal(
    readCmsSignerIdentity(encode(tree))?.displayName,
    "Синтетический Подписант",
  );
});

test("control characters, bidi formatting, invalid UTF-8 and repeated common names are rejected", () => {
  for (const value of [
    Buffer.from("name\nverified:true"),
    Buffer.from("name\u202eevil"),
    Buffer.from([0xc3, 0x28]),
    Buffer.from("x".repeat(301)),
  ]) {
    const tree = fixtureTree();
    parts(tree).cn.data = value;
    assert.equal(readCmsSignerIdentity(encode(tree)), null);
  }
  const tree = fixtureTree();
  const { subject } = parts(tree);
  subject.children!.push(subject.children![0]);
  assert.equal(readCmsSignerIdentity(encode(tree)), null);
});

test("malformed, truncated, trailing, oversized or overly nested metadata is unavailable", () => {
  for (const input of [
    fixture.subarray(0, -1),
    Buffer.concat([fixture, Buffer.from([0])]),
    Buffer.alloc(3_000_001),
    Buffer.concat([
      Buffer.from("3080".repeat(40), "hex"),
      fixture,
      Buffer.alloc(80),
    ]),
    Buffer.concat([
      Buffer.from("3080", "hex"),
      Buffer.from("3000".repeat(10_001), "hex"),
      Buffer.alloc(2),
    ]),
    Buffer.concat([Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]), fixture]),
    Buffer.concat([Buffer.from([0x04, 0x80]), fixture, Buffer.alloc(2)]),
  ])
    assert.equal(readCmsSignerIdentity(input), null);
});
