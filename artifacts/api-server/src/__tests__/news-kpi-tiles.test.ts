import { describe, it, expect } from "vitest";
import { filterKpiTiles } from "../lib/newsKpiUtils.js";

const KNOWLEDGE_CONTEXT = "Quelltext aus Wissensbibliothek...";

describe("filterKpiTiles", () => {
  describe("invariant: empty knowledge context always yields []", () => {
    it("returns [] when knowledgeContext is empty string", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, "", 3)).toEqual([]);
    });

    it("returns [] even with valid-looking tiles when context is empty", () => {
      const tiles = [
        { value: "85 %", label: "Erstkonzeptionsrate", sourceIndex: 0 },
        { value: "2,4", label: "Besamungen je Trächtigkeit", sourceIndex: 1 },
      ];
      expect(filterKpiTiles(tiles, "", 1)).toEqual([]);
    });
  });

  describe("sourceIndex range validation", () => {
    it("keeps tiles with sourceIndex exactly at maxSourceIndex", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: 2 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(1);
    });

    it("removes tiles with sourceIndex one above maxSourceIndex", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: 3 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with negative sourceIndex", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: -1 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with sourceIndex = 0 when maxSourceIndex = -1 (no sources)", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, -1)).toHaveLength(0);
    });

    it("keeps tiles with sourceIndex = 0 when maxSourceIndex = 0", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 0)).toHaveLength(1);
    });
  });

  describe("field type validation", () => {
    it("removes tiles with numeric value field", () => {
      const tiles = [{ value: 42, label: "Trächtigkeitsrate", sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with numeric label field", () => {
      const tiles = [{ value: "42 %", label: 42, sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with string sourceIndex", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: "0" }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles that are null", () => {
      expect(filterKpiTiles([null], KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles that are strings", () => {
      expect(filterKpiTiles(["42 %"], KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with empty value string", () => {
      const tiles = [{ value: "", label: "Trächtigkeitsrate", sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with empty label string", () => {
      const tiles = [{ value: "42 %", label: "", sourceIndex: 0 }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });

    it("removes tiles with NaN sourceIndex", () => {
      const tiles = [{ value: "42 %", label: "Trächtigkeitsrate", sourceIndex: NaN }];
      expect(filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 2)).toHaveLength(0);
    });
  });

  describe("cap at 4 tiles", () => {
    it("returns at most 4 tiles even when more are valid", () => {
      const tiles = Array.from({ length: 6 }, (_, i) => ({
        value: `${i + 1} kg`,
        label: `Kennzahl ${i + 1}`,
        sourceIndex: 0,
      }));
      const result = filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 0);
      expect(result).toHaveLength(4);
    });
  });

  describe("mixed valid and invalid tiles", () => {
    it("keeps only the valid tiles from a mixed array", () => {
      const tiles = [
        { value: "85 %", label: "Erstkonzeptionsrate", sourceIndex: 0 },
        { value: 42, label: "Ungültig — numerischer Wert", sourceIndex: 0 },
        { value: "2,4", label: "Besamungen je Trächtigkeit", sourceIndex: 99 },
        { value: "28 Tage", label: "Güstzeit", sourceIndex: 1 },
      ];
      const result = filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 1);
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe("Erstkonzeptionsrate");
      expect(result[1].label).toBe("Güstzeit");
    });
  });

  describe("invariant documentation: non-empty context + empty result signals LLM issue", () => {
    it("returns [] when all tiles have out-of-range sourceIndex (callers should log warning)", () => {
      const tiles = [
        { value: "42 %", label: "Trächtigkeitsrate", sourceIndex: 5 },
        { value: "28 Tage", label: "Güstzeit", sourceIndex: 6 },
      ];
      const result = filterKpiTiles(tiles, KNOWLEDGE_CONTEXT, 1);
      expect(result).toHaveLength(0);
    });

    it("returns [] when rawKpiTiles is empty (callers should log warning)", () => {
      expect(filterKpiTiles([], KNOWLEDGE_CONTEXT, 3)).toHaveLength(0);
    });
  });
});
