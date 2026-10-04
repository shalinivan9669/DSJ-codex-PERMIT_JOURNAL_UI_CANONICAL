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
  switch (title) {
    case "BIOT":
      return "БиОТ";
    case "BIOT — Рабочие":
      return "БиОТ — Рабочие";
    case "BIOT — ИТР":
      return "БиОТ — ИТР";
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
