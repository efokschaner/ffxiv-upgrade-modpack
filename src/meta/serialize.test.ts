import { describe, expect, it } from "vitest";
import { deserializeMeta } from "./deserialize";
import { serializeMeta } from "./serialize";
import type { ItemMeta } from "./types";

describe("serializeMeta", () => {
  it("round-trips a structured meta byte-for-byte", () => {
    const m: ItemMeta = {
      version: 2,
      path: "chara/equipment/e0001/e0001_top.meta",
      imc: null,
      eqp: null,
      eqdp: [
        { race: 101, value: 3 },
        { race: 201, value: 0 },
      ],
      est: [{ race: 101, setId: 1, skelId: 0 }],
      gmp: null,
    };
    const bytes = serializeMeta(m);
    expect(deserializeMeta(bytes)).toEqual(m);
  });
});
