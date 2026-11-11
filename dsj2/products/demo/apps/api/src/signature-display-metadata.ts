import { createHash, X509Certificate } from "node:crypto";

export type CmsSignerDisplayIdentity = {
  displayName: string;
  certificateSerial: string;
  certificateFingerprint: string;
  source: "CMS_SIGNER_CERTIFICATE";
  identityVerified: false;
};

type Element = {
  tag: number;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  children: Element[];
};

/** A bounded BER reader for display metadata, never a CMS trust verifier. */
function readElements(bytes: Buffer) {
  let remaining = 10_000;
  function read(start: number, limit: number, depth: number): Element {
    if (--remaining < 0 || depth > 32 || start + 2 > limit)
      throw new Error("CMS_METADATA_LIMIT");
    const tag = bytes[start];
    if (!tag || (tag & 0x1f) === 0x1f) throw new Error("CMS_METADATA_TAG");
    let cursor = start + 2;
    let length = bytes[start + 1];
    const indefinite = length === 0x80;
    if (indefinite && !(tag & 0x20))
      throw new Error("CMS_METADATA_PRIMITIVE_LENGTH");
    if (!indefinite && length & 0x80) {
      const count = length & 0x7f;
      if (count > 4 || cursor + count > limit)
        throw new Error("CMS_METADATA_LENGTH");
      length = 0;
      for (let index = 0; index < count; index++)
        length = length * 256 + bytes[cursor++];
    }
    const contentStart = cursor;
    const contentEnd = indefinite ? limit : cursor + length;
    if (contentEnd > limit) throw new Error("CMS_METADATA_TRUNCATED");
    const children: Element[] = [];
    if (tag & 0x20) {
      while (cursor < contentEnd) {
        if (
          indefinite &&
          cursor + 2 <= contentEnd &&
          bytes[cursor] === 0 &&
          bytes[cursor + 1] === 0
        )
          return {
            tag,
            start,
            contentStart,
            contentEnd: cursor,
            end: cursor + 2,
            children,
          };
        const child = read(cursor, contentEnd, depth + 1);
        children.push(child);
        cursor = child.end;
      }
      if (indefinite) throw new Error("CMS_METADATA_UNTERMINATED");
    }
    return { tag, start, contentStart, contentEnd, end: contentEnd, children };
  }
  const root = read(0, bytes.length, 0);
  if (root.end !== bytes.length) throw new Error("CMS_METADATA_TRAILING_DATA");
  return root;
}

function content(bytes: Buffer, node: Element) {
  return bytes.subarray(node.contentStart, node.contentEnd);
}
function encoded(bytes: Buffer, node: Element) {
  return bytes.subarray(node.start, node.end);
}
function integer(bytes: Buffer, node: Element) {
  if (node.tag !== 0x02) throw new Error("CMS_METADATA_SERIAL");
  const value = content(bytes, node);
  if (!value.length || value[0] & 0x80) throw new Error("CMS_METADATA_SERIAL");
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset++;
  return value.subarray(offset).toString("hex");
}
function nameString(bytes: Buffer, node: Element) {
  const value = content(bytes, node);
  let text: string;
  if (node.tag === 0x0c)
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  else if (node.tag === 0x13 || node.tag === 0x16) {
    if (value.some((byte) => byte > 0x7f)) return null;
    text = value.toString("ascii");
  } else if (node.tag === 0x1e) {
    if (value.length % 2) return null;
    text = new TextDecoder("utf-16be", { fatal: true }).decode(value);
  } else return null;
  // Names are display text, never markup or a way to inject additional fields.
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text)) return null;
  text = text.normalize("NFC").trim().replace(/\s+/g, " ");
  return text.length > 0 && text.length <= 300 ? text : null;
}
function subjectDisplayName(bytes: Buffer, subject: Element) {
  if (subject.tag !== 0x30) return null;
  const names = new Map<string, string[]>();
  for (const rdn of subject.children) {
    if (rdn.tag !== 0x31) return null;
    for (const attribute of rdn.children) {
      const [oid, value] = attribute.children;
      if (
        attribute.tag !== 0x30 ||
        attribute.children.length !== 2 ||
        oid?.tag !== 6 ||
        !value
      )
        return null;
      const key = content(bytes, oid).toString("hex");
      if (!["550403", "550404", "55042a"].includes(key)) continue;
      const text = nameString(bytes, value);
      if (!text) return null;
      names.set(key, [...(names.get(key) || []), text]);
    }
  }
  const commonNames = names.get("550403") || [];
  if (commonNames.length === 1) return commonNames[0];
  if (commonNames.length > 1) return null;
  const surnames = names.get("550404") || [];
  const givenNames = names.get("55042a") || [];
  const name = [...surnames, ...givenNames].join(" ");
  return surnames.length === 1 && givenNames.length === 1 && name.length <= 300
    ? name
    : null;
}

/**
 * Read the certificate named by the single CMS SignerInfo (RFC 5652 §5.3).
 * This identifies a claim in the envelope; it does NOT verify the signature,
 * certificate, owner identity, trust chain, revocation, or signing time.
 * Unsupported/ambiguous envelopes have no display identity. In particular,
 * never substitute a configured role name for the certificate owner's name.
 */
export function readCmsSignerIdentity(
  input: Uint8Array,
): CmsSignerDisplayIdentity | null {
  if (input.byteLength < 100 || input.byteLength > 3_000_000) return null;
  try {
    const bytes = Buffer.from(input);
    const root = readElements(bytes);
    const [contentType, wrapper] = root.children;
    if (
      root.tag !== 0x30 ||
      root.children.length !== 2 ||
      contentType?.tag !== 6 ||
      content(bytes, contentType).toString("hex") !== "2a864886f70d010702" ||
      wrapper?.tag !== 0xa0 ||
      wrapper.children.length !== 1
    )
      return null;
    const signedData = wrapper.children[0];
    if (signedData.tag !== 0x30) return null;
    const fields = signedData.children;
    if (
      fields[0]?.tag !== 2 ||
      fields[1]?.tag !== 0x31 ||
      fields[2]?.tag !== 0x30
    )
      return null;
    const certificates = fields[3];
    const signerInfos = fields.at(-1);
    if (
      ![5, 6].includes(fields.length) ||
      (fields.length === 6 && fields[4].tag !== 0xa1) ||
      certificates?.tag !== 0xa0 ||
      signerInfos?.tag !== 0x31 ||
      signerInfos.children.length !== 1
    )
      return null;
    const signer = signerInfos.children[0];
    const sid = signer.children[1];
    if (
      signer.tag !== 0x30 ||
      signer.children[0]?.tag !== 2 ||
      sid?.tag !== 0x30 ||
      sid.children.length !== 2
    )
      return null;
    const [issuer, serial] = sid.children;
    if (issuer.tag !== 0x30) return null;
    const signerSerial = integer(bytes, serial);
    const matches = certificates.children.filter((certificate) => {
      if (certificate.tag !== 0x30 || certificate.children.length !== 3)
        return false;
      const tbs = certificate.children[0];
      if (tbs.tag !== 0x30) return false;
      const offset = tbs.children[0]?.tag === 0xa0 ? 1 : 0;
      const certSerial = tbs.children[offset];
      const certIssuer = tbs.children[offset + 2];
      return (
        certSerial &&
        certIssuer?.tag === 0x30 &&
        integer(bytes, certSerial) === signerSerial &&
        encoded(bytes, certIssuer).equals(encoded(bytes, issuer))
      );
    });
    if (matches.length !== 1) return null;
    const certificate = matches[0];
    const raw = encoded(bytes, certificate);
    // Parse the X.509 certificate structurally; no verify/check trust call occurs.
    const x509 = new X509Certificate(raw);
    const tbs = certificate.children[0];
    const offset = tbs.children[0]?.tag === 0xa0 ? 1 : 0;
    const subject = tbs.children[offset + 4];
    if (!subject || !x509.raw.equals(raw)) return null;
    const displayName = subjectDisplayName(bytes, subject);
    if (!displayName) return null;
    return {
      displayName,
      certificateSerial: x509.serialNumber,
      certificateFingerprint: createHash("sha256").update(raw).digest("hex"),
      source: "CMS_SIGNER_CERTIFICATE",
      identityVerified: false,
    };
  } catch {
    return null;
  }
}
