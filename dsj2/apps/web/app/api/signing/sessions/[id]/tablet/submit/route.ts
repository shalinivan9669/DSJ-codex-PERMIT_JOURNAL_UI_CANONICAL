import { proxySigningRequest } from "../../../../proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxySigningRequest(`signing/sessions/${id}/tablet/submit`, request);
}
