/** Keep support identifiers out of the operator's next-step message. */
export function operatorErrorParts(text: string) {
  const match =
    /^(.*?)\s+(?:Код обращения|Өтініш коды):\s*([a-zA-Z0-9-]{1,100})\s*$/s.exec(
      text,
    );
  return match
    ? { message: match[1], correlationId: match[2] }
    : { message: text, correlationId: null };
}
