import type { Recipient } from "./types";

const text = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");

/** An existing position in either language identifies one occupation. */
export function supplementPosition(
  item: Recipient,
  positionRu: string,
  positionKz: string,
): Recipient {
  const ru = positionRu.trim(),
    kz = positionKz.trim();
  if (
    (item.positionRu.trim() && (!ru || text(item.positionRu) !== text(ru))) ||
    (item.positionKz.trim() && (!kz || text(item.positionKz) !== text(kz)))
  )
    return item;
  const nextRu = item.positionRu.trim()
    ? item.positionRu
    : ru || item.positionRu;
  const nextKz = item.positionKz.trim()
    ? item.positionKz
    : kz || item.positionKz;
  return nextRu === item.positionRu && nextKz === item.positionKz
    ? item
    : { ...item, positionRu: nextRu, positionKz: nextKz };
}
