import { HttpError } from "../../common/http-error";

const PROFESSIONAL_TYPES = new Set(["psychologist", "doctor", "nutritionist", "physiotherapist"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, "");
}

function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length += 1) {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}

function validationError(details: Array<{ field: string; message: string }>): never {
  throw new HttpError(400, "VALIDATION_ERROR", "Dados inválidos.", details);
}

export type RegisterInput = ReturnType<typeof validateRegister>;

export function validateRegister(body: Record<string, unknown>) {
  const address = body.address && typeof body.address === "object" ? body.address as Record<string, unknown> : {};
  const input = {
    name: text(body.name), cpf: digits(body.cpf), dateOfBirth: text(body.dateOfBirth), gender: text(body.gender),
    phone: digits(body.phone), email: text(body.email).toLowerCase(), cep: digits(address.cep),
    street: text(address.street), neighborhood: text(address.neighborhood), city: text(address.city),
    stateCode: text(address.stateCode).toUpperCase(), addressNumber: text(address.number),
    complement: text(address.complement) || null, professionalType: text(body.professionalType),
    professionalLicense: text(body.professionalLicense), specialty: text(body.specialty),
    password: typeof body.password === "string" ? body.password : "",
    confirmPassword: typeof body.confirmPassword === "string" ? body.confirmPassword : "",
  };
  const errors: Array<{ field: string; message: string }> = [];
  for (const field of ["name", "cpf", "dateOfBirth", "gender", "phone", "email", "street", "neighborhood", "city", "stateCode", "addressNumber", "professionalType", "professionalLicense", "specialty", "password", "confirmPassword"] as const) {
    if (!input[field]) errors.push({ field: field === "addressNumber" ? "address.number" : field, message: "Obrigatório" });
  }
  if (!input.cep) errors.push({ field: "address.cep", message: "Obrigatório" });
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.push({ field: "email", message: "E-mail inválido" });
  if (input.cpf && !validCpf(input.cpf)) errors.push({ field: "cpf", message: "CPF inválido" });
  if (input.phone && !/^\d{10,11}$/.test(input.phone)) errors.push({ field: "phone", message: "Use 10 ou 11 dígitos" });
  if (input.cep && !/^\d{8}$/.test(input.cep)) errors.push({ field: "address.cep", message: "Use 8 dígitos" });
  if (input.stateCode && !/^[A-Z]{2}$/.test(input.stateCode)) errors.push({ field: "address.stateCode", message: "UF inválida" });
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null;
  if (input.dateOfBirth && (!birth || Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== input.dateOfBirth || birth > new Date())) errors.push({ field: "dateOfBirth", message: "Data inválida ou futura" });
  if (input.professionalType && !PROFESSIONAL_TYPES.has(input.professionalType)) errors.push({ field: "professionalType", message: "Tipo profissional inválido" });
  if (errors.length) validationError(errors);
  if (input.password !== input.confirmPassword) throw new HttpError(422, "PASSWORD_MISMATCH", "As senhas não coincidem.");
  if (input.password.length < 8 || !/[A-Za-z]/.test(input.password) || !/\d/.test(input.password) || !/[^A-Za-z\d]/.test(input.password)) validationError([{ field: "password", message: "Use ao menos 8 caracteres, uma letra, um número e um caractere especial" }]);
  return { ...input, dateOfBirth: birth! };
}
