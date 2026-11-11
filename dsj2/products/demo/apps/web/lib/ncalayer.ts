// knca.basics returns CMS in PEM as well as bare Base64. Remove only a single,
// complete CMS envelope; keep the signed bytes unchanged for server verification.
function cmsBase64(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pem =
    /^[\r\n]*-----BEGIN CMS-----\r?\n?([A-Za-z0-9+/=\r\n]+)-----END CMS-----[\r\n]*$/.exec(
      value,
    );
  const compact = (pem ? pem[1] : value).replace(/[\r\n]/g, "");
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length > 100
    ? compact
    : null;
}

type SignerSelection = {
  iin?: string;
  bin?: string;
};

/** Official knca.basics CMS flow; the server independently verifies the result. */
export async function signWithNCALayer(
  input: SignerSelection & { dataBase64: string },
): Promise<string> {
  const signatures = await requestSignatures(input);
  return signatures[0];
}

/** One Basics request signs the array with one key selection/confirmation flow.
 * Results retain request order; each CMS must still be verified against its
 * corresponding original by the server before that document is completed.
 * https://github.com/pkigovkz/NCALayerJSExample/blob/master/js/ncalayer.js */
export function signManyWithNCALayer(
  input: SignerSelection & { dataBase64: readonly string[] },
): Promise<string[]> {
  if (
    !Array.isArray(input.dataBase64) ||
    input.dataBase64.length === 0 ||
    Array.from(input.dataBase64).some(
      (data) => typeof data !== "string" || data.length === 0,
    )
  )
    return Promise.reject(new Error("Выберите документы для подписания."));
  // Freeze the positional association before waiting for the local socket.
  return requestSignatures({ ...input, dataBase64: [...input.dataBase64] });
}

function requestSignatures(
  input: SignerSelection & { dataBase64: string | readonly string[] },
): Promise<string[]> {
  const batch = Array.isArray(input.dataBase64);
  const expectedCount = batch ? input.dataBase64.length : 1;
  return new Promise((resolve, reject) => {
    let finished = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket("wss://127.0.0.1:13579/");
    } catch {
      reject(
        new Error(
          "Не удалось подключиться к NCALayer. Запустите приложение и повторите подписание.",
        ),
      );
      return;
    }
    const timeout = window.setTimeout(
      () =>
        finish(
          new Error("Время ожидания NCALayer истекло. Повторите подписание."),
        ),
      120000,
    );
    function finish(error?: Error, signatures?: string[]) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else if (signatures) resolve(signatures);
    }
    socket.onopen = () => {
      if (finished) return;
      try {
        socket.send(
          JSON.stringify({
            module: "kz.gov.pki.knca.basics",
            method: "sign",
            args: {
              format: "cms",
              data: input.dataBase64,
              signingParams: {
                decode: true,
                encapsulate: false,
                digested: false,
              },
              signerParams: {
                extKeyUsageOids: ["1.3.6.1.5.5.7.3.4"],
                ...(input.iin ? { iin: input.iin } : {}),
                ...(input.bin ? { bin: input.bin } : {}),
              },
              locale: "ru",
            },
          }),
        );
      } catch {
        finish(
          new Error(
            "Не удалось передать документ в NCALayer. Повторите подключение.",
          ),
        );
      }
    };
    socket.onmessage = (event) => {
      if (finished) return;
      let response: {
        status?: boolean;
        body?: { result?: unknown };
        result?: { version?: string };
      };
      try {
        response = JSON.parse(String(event.data)) as typeof response;
        if (
          !response ||
          typeof response !== "object" ||
          Array.isArray(response)
        )
          throw new Error("Invalid NCALayer response");
      } catch {
        finish(
          new Error("NCALayer вернул непонятный ответ. Повторите подключение."),
        );
        return;
      }
      if (response.result?.version && response.status === undefined) return;
      if (response.status === false) {
        finish(
          new Error(
            "Подписание отменено или NCALayer не смог использовать выбранный ключ.",
          ),
        );
        return;
      }
      const value = response.body?.result;
      const signatures =
        typeof value === "object" && value !== null && "signatures" in value
          ? (value as { signatures: unknown }).signatures
          : value;
      const entries = Array.isArray(signatures)
        ? signatures
        : batch
          ? []
          : [signatures];
      // Never truncate, flatten, sort, or retry a partial batch as single calls.
      // All results must be usable before any are returned to the caller.
      const normalized = entries.map(cmsBase64);
      if (
        response.status === true &&
        normalized.length === expectedCount &&
        normalized.every((signature): signature is string => signature !== null)
      )
        finish(undefined, normalized);
      else if (response.status !== undefined)
        finish(
          new Error(
            batch
              ? "NCALayer не вернул полный набор подписей документов. Повторите подписание."
              : "NCALayer не вернул подпись документа. Повторите подписание.",
          ),
        );
    };
    socket.onerror = () =>
      finish(
        new Error(
          "NCALayer недоступен. Запустите его на этом компьютере и проверьте доступ браузера к приложению.",
        ),
      );
    socket.onclose = () => {
      if (!finished)
        finish(
          new Error("Соединение с NCALayer закрыто до завершения подписания."),
        );
    };
  });
}
