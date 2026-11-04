/** Preserve the download and saved-request identifier returned by the API. */
export async function biotGenerationProxyResponse(response: Response): Promise<Response> {
  const headers = new Headers({
    "Content-Type": response.headers.get("Content-Type") ?? "text/plain; charset=utf-8",
  });
  for (const name of ["Content-Disposition", "X-Card-Request-Id"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  const body = await response.arrayBuffer();
  return new Response([204, 205, 304].includes(response.status) ? null : body, {
    status: response.status,
    headers,
  });
}
