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
        const response = await this.persist(value, revision);
        this.revision = response.revision;
        this.savedVersion = version;
        this.changed(this.dirty ? "dirty" : "saved", this.revision);
      } catch (error) {
        this.changed("error", this.revision, error);
        throw error;
      } finally {
        this.inFlight = undefined;
      }
    })();
    await this.inFlight;
    return this.flush();
  }
}
