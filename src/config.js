export function readPositiveIntegerEnv(
  name,
  fallback,
  {
    max = Number.MAX_SAFE_INTEGER,
    env = process.env
  } = {}
) {
  const rawValue = env[name];

  if (
    rawValue === undefined ||
    String(rawValue).trim() === ""
  ) {
    return fallback;
  }

  const normalizedValue =
    String(rawValue).trim();

  if (!/^[1-9]\d*$/.test(normalizedValue)) {
    throw new Error(
      `Variável de ambiente ${name} deve ser um inteiro positivo.`
    );
  }

  const parsedValue = Number(normalizedValue);

  if (
    !Number.isSafeInteger(parsedValue) ||
    parsedValue > max
  ) {
    throw new Error(
      `Variável de ambiente ${name} deve ser um inteiro positivo dentro do limite permitido.`
    );
  }

  return parsedValue;
}