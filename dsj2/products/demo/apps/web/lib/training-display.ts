import type { TrainingDirection } from "@demo/contracts";

const directionLabels: Record<TrainingDirection, string> = {
  BIOT: "БиОТ",
  PTM: "ПТМ",
  PB: "ПБ",
  PS: "ПС",
};

export function trainingDirectionLabel(direction: TrainingDirection) {
  return directionLabels[direction];
}

/** Display only the exact generated legacy titles; preserve custom names and all saved values. */
export function trainingDisplayTitle(title: string) {
  if (/^BIOT(?: — (?:Рабочие|ИТР))*$/.test(title))
    return "БиОТ" + title.slice(4);
  switch (title) {
    case "PTM":
      return "ПТМ";
    case "PB":
      return "ПБ";
    case "PS":
      return "ПС — обучение по профессии";
    default:
      return title;
  }
}
