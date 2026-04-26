import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffArrays } from "diff";

// Extracted from extension.mjs for testing
function computeChangedLines(before, after) {
    const changes = diffArrays(before, after);
    const ranges = [];
    let afterLine = 1;

    for (const change of changes) {
        if (change.removed) continue;
        if (change.added) {
            const start = afterLine;
            const end = afterLine + change.count - 1;
            if (ranges.length > 0 && start === ranges[ranges.length - 1][1] + 1) {
                ranges[ranges.length - 1][1] = end;
            } else {
                ranges.push([start, end]);
            }
            afterLine += change.count;
        } else {
            afterLine += change.count;
        }
    }
    return ranges;
}

describe("computeChangedLines", () => {
    it("detects simple replacement", () => {
        const before = ["a", "b", "c"];
        const after = ["a", "X", "c"];
        assert.deepEqual(computeChangedLines(before, after), [[2, 2]]);
    });

    it("detects insertion in the middle", () => {
        const before = ["a", "b", "c"];
        const after = ["a", "x", "b", "c"];
        assert.deepEqual(computeChangedLines(before, after), [[2, 2]]);
    });

    it("detects insertion at the end", () => {
        const before = ["a", "b"];
        const after = ["a", "b", "c", "d"];
        assert.deepEqual(computeChangedLines(before, after), [[3, 4]]);
    });

    it("detects deletion (no AI lines)", () => {
        const before = ["a", "b", "c"];
        const after = ["a", "c"];
        assert.deepEqual(computeChangedLines(before, after), []);
    });

    it("handles new file (empty before)", () => {
        const before = [];
        const after = ["a", "b", "c"];
        assert.deepEqual(computeChangedLines(before, after), [[1, 3]]);
    });

    it("handles no changes", () => {
        const before = ["a", "b", "c"];
        const after = ["a", "b", "c"];
        assert.deepEqual(computeChangedLines(before, after), []);
    });

    it("handles multiple changed regions", () => {
        const before = ["a", "b", "c", "d", "e"];
        const after = ["a", "X", "c", "Y", "e"];
        assert.deepEqual(computeChangedLines(before, after), [[2, 2], [4, 4]]);
    });

    it("handles replace + insert combo", () => {
        const before = ["a", "b", "c"];
        const after = ["a", "X", "Y", "c"];
        // "b" replaced by "X", "Y" inserted - or "b" replaced by "X" and "Y" inserted
        const result = computeChangedLines(before, after);
        // Lines 2-3 should be marked as AI
        assert.deepEqual(result, [[2, 3]]);
    });

    it("handles complete rewrite", () => {
        const before = ["a", "b", "c"];
        const after = ["x", "y", "z"];
        assert.deepEqual(computeChangedLines(before, after), [[1, 3]]);
    });
});
