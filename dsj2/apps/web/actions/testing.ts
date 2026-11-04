"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiFetch } from "../lib/api";
import { buildQuestionsPayload } from "../lib/exam-form";

function buildTestingUrl(pathname: string, companyId: string | null, error?: string) {
  const params = new URLSearchParams();

  if (companyId) {
    params.set("companyId", companyId);
  }

  if (error) {
    params.set("error", error);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export async function createExamAction(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "") || null;

  try {
    await apiFetch("exams", {
      method: "POST",
      body: JSON.stringify({
        companyId,
        trainingProgramId: String(formData.get("trainingProgramId") ?? ""),
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? "") || null,
        passingScore: Number(formData.get("passingScore") ?? "80"),
        maxAttempts: Number(formData.get("maxAttempts") ?? "3"),
        questions: buildQuestionsPayload(formData),
      }),
    });
  } catch (error) {
    redirect(
      buildTestingUrl(
        "/testing",
        companyId,
        error instanceof Error ? error.message : "Не удалось создать тест.",
      ),
    );
  }

  revalidatePath("/testing");
  revalidatePath("/my-testing");
  redirect(buildTestingUrl("/testing", companyId));
}

export async function startMyExamAction(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") ?? "");

  try {
    await apiFetch(`exams/my/${assignmentId}/start`, {
      method: "POST",
    });
  } catch (error) {
    redirect(
      buildTestingUrl(
        `/my-testing/${assignmentId}`,
        null,
        error instanceof Error ? error.message : "Не удалось начать тестирование.",
      ),
    );
  }

  revalidatePath("/my-testing");
  revalidatePath(`/my-testing/${assignmentId}`);
  redirect(`/my-testing/${assignmentId}`);
}

export async function submitMyExamAction(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const answers = Array.from(formData.entries())
    .filter(([key]) => key.startsWith("answer_"))
    .map(([key, value]) => ({
      questionId: key.replace("answer_", ""),
      optionId: String(value),
    }))
    .filter((item) => item.optionId.length > 0);

  try {
    await apiFetch(`exams/my/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify({
        answers,
      }),
    });
  } catch (error) {
    redirect(
      buildTestingUrl(
        `/my-testing/${assignmentId}`,
        null,
        error instanceof Error ? error.message : "Не удалось завершить тестирование.",
      ),
    );
  }

  revalidatePath("/my-testing");
  revalidatePath(`/my-testing/${assignmentId}`);
  revalidatePath("/my-training");
  redirect(`/my-testing/${assignmentId}`);
}
