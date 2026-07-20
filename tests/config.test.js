import test from "node:test";
import assert from "node:assert/strict";

import {
  readPositiveIntegerEnv
} from "../src/config.js";

test(
  "usa o valor padrão quando a variável não foi definida",
  () => {
    const value = readPositiveIntegerEnv(
      "PORT",
      3000,
      {
        env: {}
      }
    );

    assert.equal(value, 3000);
  }
);

test(
  "aceita um inteiro positivo válido",
  () => {
    const value = readPositiveIntegerEnv(
      "PORT",
      3000,
      {
        max: 65_535,
        env: {
          PORT: " 4500 "
        }
      }
    );

    assert.equal(value, 4500);
  }
);

test(
  "rejeita valores numéricos inválidos",
  () => {
    const invalidValues = [
      "0",
      "-1",
      "1.5",
      "abc",
      "70000"
    ];

    for (const invalidValue of invalidValues) {
      assert.throws(
        () =>
          readPositiveIntegerEnv(
            "PORT",
            3000,
            {
              max: 65_535,
              env: {
                PORT: invalidValue
              }
            }
          ),
        /Variável de ambiente PORT/
      );
    }
  }
);