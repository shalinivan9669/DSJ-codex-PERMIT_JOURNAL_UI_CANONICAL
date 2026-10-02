/** Official knca.basics CMS flow; the server independently verifies the result. */
export function signWithNCALayer(input: {
  dataBase64: string;
  iin?: string;
  bin?: string;
}): Promise<string> {
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
    function finish(error?: Error, signature?: string) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else if (signature) resolve(signature);
    }
    socket.onopen = () =>
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
              ...(input.iin ? { iin: input.iin } : {}),
              ...(input.bin ? { bin: input.bin } : {}),
              chain: null,
            },
            locale: "ru",
          },
        }),
      );
    socket.onmessage = (event) => {
      let response: {
        status?: boolean;
        body?: { result?: unknown };
        result?: { version?: string };
      };
      try {
        response = JSON.parse(String(event.data)) as typeof response;
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
      const signature = Array.isArray(signatures)
        ? signatures.length === 1
          ? signatures[0]
          : null
        : signatures;
      if (
        response.status === true &&
        typeof signature === "string" &&
        /^[A-Za-z0-9+/=\r\n]+$/.test(signature) &&
        signature.length > 100
      )
        finish(undefined, signature);
      else if (response.status !== undefined)
        finish(
          new Error(
            "NCALayer не вернул подпись документа. Повторите подписание.",
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
