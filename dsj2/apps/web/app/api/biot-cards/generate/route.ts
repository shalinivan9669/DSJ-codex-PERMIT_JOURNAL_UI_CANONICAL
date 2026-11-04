import { getApiUrl, getSessionToken } from "../../../../lib/api";
import { biotGenerationProxyResponse } from "../../../../lib/biot-generation-response";

export async function POST(request: Request) {
  const token = await getSessionToken();

  if (!token) {
    return new Response("Не авторизован", { status: 401 });
  }

  const payload = await request.text();
  const response = await fetch(getApiUrl("biot-cards/generate-batch"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
    cache: "no-store",
  });

  return biotGenerationProxyResponse(response);
}
