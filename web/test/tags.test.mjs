import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { playerTags, statusLabel, verdictTag } from "../src/model/tags.js";

describe("tags", () => {
  test("a verdict's chip never strands a leading word", () => {
    assert.equal(verdictTag("AVOID"), "AVOID");
    assert.equal(verdictTag("STASH 160+"), "STASH 160+");
    assert.equal(verdictTag("DO NOT DRAFT"), "DO NOT"); // not a bare "DO"
    assert.equal(verdictTag("WAIT FOR PRICE"), "WAIT");
  });

  test("ESPN's status enums become short labels", () => {
    assert.equal(statusLabel("INJURY_RESERVE"), "IR");
    assert.equal(statusLabel("OUT"), "out");
    assert.equal(statusLabel("QUESTIONABLE"), "Questionable");
  });

  test("a verdict stands alone; a status only shows when there is no call", () => {
    assert.deepEqual(playerTags({ out: true, status: "OUT", verdict: "", mark: "" }), [
      { kind: "out", text: "out" },
    ]);
    assert.deepEqual(playerTags({ out: true, status: "OUT", verdict: "DO NOT DRAFT", mark: "" }), [
      { kind: "avoid", text: "do not", title: "DO NOT DRAFT" },
    ]);
    assert.deepEqual(playerTags({ out: false, verdict: "STASH 160+", mark: "alert" }), [
      { kind: "stash", text: "stash 160+", title: undefined },
    ]);
    assert.deepEqual(playerTags({ out: false, verdict: "", mark: "alert" }), [
      { kind: "alert", text: "news" },
    ]);
    assert.deepEqual(playerTags({ out: false, verdict: "", mark: "target" }), [
      { kind: "target", text: "target" },
    ]);
  });
});
