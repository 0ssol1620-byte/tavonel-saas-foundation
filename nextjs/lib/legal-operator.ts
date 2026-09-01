type Environment = Readonly<Record<string, string | undefined>>;

export type LegalOperator = {
  businessName: string;
  representative: string;
  businessNumber: string;
  address: string;
  phone: string;
  email: string;
};

export function readLegalOperator(env: Environment = process.env): LegalOperator | null {
  const operator = {
    businessName: env.TAVONEL_LEGAL_BUSINESS_NAME?.trim() ?? "",
    representative: env.TAVONEL_LEGAL_REPRESENTATIVE?.trim() ?? "",
    businessNumber: env.TAVONEL_LEGAL_BUSINESS_NUMBER?.trim() ?? "",
    address: env.TAVONEL_LEGAL_ADDRESS?.trim() ?? "",
    phone: env.TAVONEL_LEGAL_PHONE?.trim() ?? "",
    email: env.TAVONEL_LEGAL_EMAIL?.trim().toLowerCase() ?? "",
  };
  if (Object.values(operator).some((value) => !value)) return null;
  if (!/^\d{3}-\d{2}-\d{5}$/.test(operator.businessNumber)) return null;
  if (!/^\+?[0-9][0-9 ()-]{7,24}$/.test(operator.phone)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator.email)) return null;
  return operator;
}
