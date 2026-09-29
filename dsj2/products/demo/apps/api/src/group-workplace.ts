/** Pin factual names in new snapshots; old snapshots keep their old header. */
export function groupHeaderWorkplace(
  templateId: string,
  items: Array<{ workplaceRu?: string; workplaceKz?: string }>,
) {
  if (
    !["biot-protocol", "biot-itr-protocol", "pb-protocol"].includes(templateId)
  )
    return undefined;
  const names = (key: "workplaceRu" | "workplaceKz") =>
    [...new Set(items.map((item) => item[key] || "").filter(Boolean))].join(
      "; ",
    );
  return {
    version: 1,
    workplaceRu: names("workplaceRu"),
    workplaceKz: names("workplaceKz"),
  };
}
