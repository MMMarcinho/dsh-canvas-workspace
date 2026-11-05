/** Display only answers returned by the native ask tool, matched to its questions. */
export function questionAnswers(argumentsText: string, resultText: string) {
  try {
    const request = JSON.parse(argumentsText);
    const result = JSON.parse(resultText);
    if (!Array.isArray(request?.questions) || !Array.isArray(result?.answers))
      return [];
    const ids = new Set(
      request.questions.flatMap((question: { id?: unknown }) =>
        question && typeof question.id === "string" ? [question.id] : [],
      ),
    );
    const seen = new Set<string>();
    return result.answers.flatMap(
      (answer: { id?: unknown; selected?: unknown; custom?: unknown }) => {
        if (
          !answer ||
          typeof answer.id !== "string" ||
          !ids.has(answer.id) ||
          seen.has(answer.id) ||
          !Array.isArray(answer.selected) ||
          !answer.selected.every(
            (value: unknown) => typeof value === "string",
          ) ||
          (answer.custom !== undefined && typeof answer.custom !== "string")
        )
          return [];
        seen.add(answer.id);
        const text = [
          ...answer.selected,
          ...(typeof answer.custom === "string" && answer.custom
            ? [answer.custom]
            : []),
        ].join("\n");
        return text ? [{ id: answer.id, text }] : [];
      },
    );
  } catch {
    return [];
  }
}
