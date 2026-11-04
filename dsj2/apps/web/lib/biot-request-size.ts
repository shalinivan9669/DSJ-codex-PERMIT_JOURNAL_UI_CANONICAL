// The API's default JSON parser currently accepts at most 100 KiB.
export const MAX_BIOT_REQUEST_BYTES = 100 * 1024;

export function serializeBiotRequest(payload: object): string {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > MAX_BIOT_REQUEST_BYTES) {
    throw new Error(
      "Заявка слишком большая для отправки. Уменьшите количество или размер фотографий либо разделите сотрудников на несколько заявок.",
    );
  }
  return body;
}
