/** One serialized lane: a response acknowledges a captured local generation, never replaces current input. */
export class AutosaveLane<T> {
  private localVersion = 0;
  private savedVersion = 0;
  private inFlight: Promise<void> | undefined;
  private value: T;
  private revision: number;
  constructor(
    value: T,
    revision: number,
    private readonly persist: (
      value: T,
      revision: number,
    ) => Promise<{ revision: number }>,
    private readonly changed: (
      state: "dirty" | "saving" | "saved" | "error",
      revision: number,
      error?: unknown,
      capturedVersion?: number,
    ) => void,
  ) {
    this.value = value;
    this.revision = revision;
  }
  edit(value: T) {
    this.value = value;
    this.localVersion += 1;
    this.changed("dirty", this.revision);
  }
  get dirty() {
    return this.savedVersion !== this.localVersion;
  }
  get currentRevision() {
    return this.revision;
  }
  get currentVersion() {
    return this.localVersion;
  }
  private async persistSnapshot(value: T, revision: number) {
    // Convert a synchronous adapter failure to a rejected promise so the
    // inFlight assignment happens before its finally clears the lane.
    return this.persist(value, revision);
  }
  async flush(): Promise<number> {
    if (this.inFlight) {
      await this.inFlight;
      return this.flush();
    }
    if (!this.dirty) return this.revision;
    const value = structuredClone(this.value);
    const version = this.localVersion;
    const revision = this.revision;
    this.changed("saving", revision);
    this.inFlight = (async () => {
      try {
        const response = await this.persistSnapshot(value, revision);
        if (
          !Number.isSafeInteger(response?.revision) ||
          response.revision <= revision
        )
          throw new Error(
            "Сервер не подтвердил новую редакцию. Ваш ввод остаётся на странице; повторите сохранение.",
          );
        this.revision = response.revision;
        this.savedVersion = version;
        this.changed(
          this.dirty ? "dirty" : "saved",
          this.revision,
          undefined,
          version,
        );
      } catch (error) {
        this.changed("error", this.revision, error, version);
        throw error;
      } finally {
        this.inFlight = undefined;
      }
    })();
    await this.inFlight;
    return this.flush();
  }
}
