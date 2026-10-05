"use client";
import { useMemo, useState } from "react";
import {
  approvalReviewSummary,
  reviewSourceLabels,
  type ApprovalReview,
} from "@/lib/approval-review";
import { documentTitle } from "@/lib/types";
import type { Draft } from "@demo/contracts";
import { trainingDisplayTitle } from "@/lib/training-display";

const values = (entries: Set<string>) => [...entries].join(", ");

export function ApprovalReviewPanel({
  review,
  submitted,
}: {
  review: ApprovalReview;
  submitted?: Draft | null;
}) {
  const summary = useMemo(
    () => approvalReviewSummary(review, submitted || review.draft),
    [review, submitted],
  );
  const [showPeople, setShowPeople] = useState(false);
  return (
    <section
      className="approval-effective-review"
      aria-label="Подготовленные данные редакции"
    >
      <h3>Что получат люди</h3>
      <p>
        <strong>
          {summary.people} человек · {summary.courses.length} обучений
        </strong>
        {summary.exceptions > 0
          ? ` · индивидуальные значения или исключения у ${summary.exceptions} человек`
          : " · без индивидуальных исключений"}
        . Одно решение относится ко всему показанному составу и связанным
        формам.
      </p>
      <div className="table-scroll">
        <table className="approval-course-summary">
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "34%" }} />
            <col style={{ width: "32%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Обучение и состав</th>
              <th>Даты и часы</th>
              <th>Результат</th>
            </tr>
          </thead>
          <tbody>
            {summary.courses.map((course) => (
              <tr key={course.id}>
                <th scope="row">
                  {trainingDisplayTitle(course.title)}
                  <br />
                  <small>
                    {course.people.size} человек ·{" "}
                    {[...course.documents]
                      .map((id) => documentTitle(id))
                      .join(", ")}
                  </small>
                </th>
                <td>
                  Выдача: {values(course.documentDates)}
                  <br />
                  Протокол: {values(course.protocolDates)}
                  <br />
                  Обучение: {values(course.periods)}
                  <br />
                  Часы теория / практика: {values(course.hours)}
                </td>
                <td>
                  {values(course.results)}
                  <br />
                  <details>
                    <summary>Источники значений</summary>
                    {values(course.sources)}
                  </details>
                  {course.exceptions.size > 0 && (
                    <p>
                      Индивидуальные значения: {course.exceptions.size} человек
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details onToggle={(event) => setShowPeople(event.currentTarget.open)}>
        <summary>
          Предпросмотр данных всех людей и документов ({summary.people})
        </summary>
        <p>
          Показаны разрешённые значения переданной редакции, включая общие
          данные и настройки центра.
        </p>
        {showPeople && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Получатель</th>
                  <th>Документ</th>
                  <th>Подготовленные данные</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {review.draft.items.flatMap((row) =>
                  row.assignments.map((assignment) => {
                    const provenance =
                      review.provenance[`${row.id}:${assignment.id}`] || {};
                    return (
                      <tr key={`${row.id}:${assignment.id}`}>
                        <th scope="row">
                          {row.fullNameRu || "ФИО не заполнено"}
                          <br />
                          <small>
                            {row.positionRu}
                            <br />
                            {row.workplaceRu}
                          </small>
                        </th>
                        <td>
                          {documentTitle(assignment.templateId)}
                          <br />
                          {assignment.trainingSubject}
                        </td>
                        <td>
                          Выдача: {assignment.documentDate || "Не задана"}
                          <br />
                          Протокол: {assignment.protocolDate || "Не задана"}
                          <br />
                          {assignment.trainingStart} — {assignment.trainingEnd}
                          <br />
                          {assignment.validityMode === "UNLIMITED"
                            ? "Бессрочно"
                            : `Действует до: ${assignment.validUntil || "Не задано"}`}
                          <br />
                          Результат: {assignment.result || "Ожидает сдачи"}
                        </td>
                        <td>
                          Дата:{" "}
                          {reviewSourceLabels[provenance.documentDate] ||
                            "Сохранённое значение"}
                          <br />
                          Программа:{" "}
                          {reviewSourceLabels[provenance.trainingSubject] ||
                            "Сохранённое значение"}
                          <br />
                          Результат:{" "}
                          {assignment.outcome?.source ||
                            reviewSourceLabels[
                              assignment.fieldOrigins?.result || ""
                            ] ||
                            "Источник не задан"}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
