export function buildQuestionsPayload(formData: FormData) {
  const questionCount = Number(formData.get("questionCount") ?? "0");
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 10) {
    throw new Error("Добавьте от 1 до 10 вопросов.");
  }

  return Array.from({ length: questionCount }, (_, index) => {
    const prompt = String(formData.get(`questionPrompt_${index}`) ?? "").trim();
    const originalOptions = [0, 1, 2, 3].map((optionIndex) =>
      String(formData.get(`questionOption_${index}_${optionIndex}`) ?? "").trim(),
    );
    const selectedValue = formData.get(`questionCorrectIndex_${index}`);
    const selectedIndex = selectedValue === null || String(selectedValue).trim() === ""
      ? -1
      : Number(selectedValue);
    const options = originalOptions.filter((value) => value.length > 0);

    if (!prompt || options.length < 2) {
      throw new Error(`Заполните вопрос ${index + 1} и не менее двух вариантов ответа.`);
    }

    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= originalOptions.length || !originalOptions[selectedIndex]) {
      throw new Error(`Выберите заполненный правильный вариант для вопроса ${index + 1}.`);
    }

    // The UI permits empty optional slots; map the selected original slot to
    // its position after those empty slots are removed.
    const correctOptionIndex = originalOptions
      .slice(0, selectedIndex)
      .filter((value) => value.length > 0).length;

    return { prompt, options, correctOptionIndex };
  });
}
