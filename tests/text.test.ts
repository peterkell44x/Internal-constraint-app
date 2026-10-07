import assert from "node:assert/strict";
import { test } from "node:test";

import { dropUnansweredQuestion } from "../src/lib/diagnostic/text.ts";

test("dropUnansweredQuestion removes a final guide question the person never answered", () => {
  const h = [
    { role: "user" as const, content: "they'd take it" },
    { role: "assistant" as const, content: "Is wanting multiple girls partly about that?" },
  ];
  assert.deepEqual(dropUnansweredQuestion(h), h.slice(0, 1));
  const closed = [h[0], { role: "assistant" as const, content: "I have what I need to build your profile now." }];
  assert.deepEqual(dropUnansweredQuestion(closed), closed);
  assert.deepEqual(dropUnansweredQuestion(h.slice(0, 1)), h.slice(0, 1));
});
