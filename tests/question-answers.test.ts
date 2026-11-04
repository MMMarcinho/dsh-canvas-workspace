import test from "node:test";
import assert from "node:assert/strict";
import { questionAnswers } from "../src/adapters/question-answers";
const request = JSON.stringify({ questions: [{ id: "q" }, { id: "second" }] });
test("question answers preserve exact custom text, selection and separate answer identities", () => {
  assert.deepEqual(
    questionAnswers(
      request,
      JSON.stringify({
        answers: [
          {
            id: "q",
            selected: [],
            custom: "  我之前做的那个 open-intelligent-ui\n",
          },
          { id: "second", selected: ["A", "B"] },
        ],
      }),
    ),
    [
      { id: "q", text: "  我之前做的那个 open-intelligent-ui\n" },
      { id: "second", text: "A\nB" },
    ],
  );
});
test("question projection ignores malformed, unknown, duplicated and unanswered results", () => {
  assert.deepEqual(questionAnswers(request, "not JSON"), []);
  assert.deepEqual(questionAnswers("null", "null"), []);
  assert.deepEqual(
    questionAnswers(
      request,
      JSON.stringify({
        answers: [
          { id: "unknown", selected: [], custom: "unknown" },
          { id: "q", selected: [42] },
          { id: "q", selected: [], custom: "answer" },
          { id: "q", selected: [], custom: "duplicate" },
          { id: "second", selected: [], custom: "" },
        ],
      }),
    ),
    [{ id: "q", text: "answer" }],
  );
});
