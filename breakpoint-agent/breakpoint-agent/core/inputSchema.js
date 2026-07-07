// Shared definition of business-model input fields.
// Used by the CLI (flag parsing + interactive prompts) and the Telegram bot
// (guided conversation) so both channels accept the same inputs.

export const BUSINESS_TYPES = ['saas', 'subscription', 'ecommerce', 'physical', 'marketplace', 'other']

// Ordered list of fields. `required` fields are needed for a meaningful
// analysis; the rest are optional (default to 0 when omitted).
export const INPUT_FIELDS = [
  { key: 'businessType', label: 'Business type', type: 'enum', options: BUSINESS_TYPES, required: true,
    hint: 'One of: ' + ['saas', 'subscription', 'ecommerce', 'physical', 'marketplace', 'other'].join(', ') },
  { key: 'pricing', label: 'Price per customer ($)', type: 'number', required: true,
    hint: 'Revenue per customer per billing cycle, e.g. 49' },
  { key: 'billingCycle', label: 'Billing cycle', type: 'enum', options: ['monthly', 'annual'], required: false,
    default: 'monthly', hint: 'monthly or annual' },
  { key: 'monthlyChurn', label: 'Monthly churn (%)', type: 'number', required: true,
    hint: 'Percent of customers lost each month, e.g. 5' },
  { key: 'cac', label: 'Customer acquisition cost ($)', type: 'number', required: true,
    hint: 'Cost to acquire one customer, e.g. 200' },
  { key: 'fixedCosts', label: 'Fixed monthly costs ($)', type: 'number', required: true,
    hint: 'Rent, salaries, tooling, etc., e.g. 15000' },
  { key: 'variableCostPerUnit', label: 'Variable cost per customer ($)', type: 'number', required: false,
    default: 0, hint: 'Cost to serve one customer, e.g. 5' },
  { key: 'monthlyNewCustomers', label: 'New customers / month', type: 'number', required: true,
    hint: 'Customers acquired each month, e.g. 50' },
  { key: 'currentRevenue', label: 'Current monthly revenue ($)', type: 'number', required: false,
    default: 0, hint: 'Starting MRR, e.g. 0' },
  { key: 'currentCustomers', label: 'Current customer count', type: 'number', required: false,
    default: 0, hint: 'Customers you already have, e.g. 0' },
  { key: 'currentRunway', label: 'Current runway (months)', type: 'number', required: false,
    default: 0, hint: 'Months of cash left, e.g. 12' }
]

export const REQUIRED_KEYS = INPUT_FIELDS.filter(f => f.required).map(f => f.key)

// Coerce a raw value (string from CLI/Telegram) into the correct type.
export function coerceValue(field, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return field.default !== undefined ? field.default : undefined
  }
  if (field.type === 'number') {
    const n = parseFloat(rawValue)
    return isNaN(n) ? undefined : n
  }
  return String(rawValue).trim()
}

// Validate a partial inputs object. Returns { valid, errors, inputs }.
export function validateInputs(raw = {}) {
  const errors = []
  const inputs = {}

  for (const field of INPUT_FIELDS) {
    const value = coerceValue(field, raw[field.key])

    if (value === undefined) {
      if (field.required) {
        errors.push(`Missing required field: ${field.key} (${field.label})`)
      } else if (field.default !== undefined) {
        inputs[field.key] = field.default
      }
      continue
    }

    if (field.type === 'enum' && !field.options.includes(value)) {
      errors.push(`Invalid ${field.key}: "${value}". Expected one of: ${field.options.join(', ')}`)
      continue
    }

    inputs[field.key] = value
  }

  return { valid: errors.length === 0, errors, inputs }
}

// A ready-to-run example input (SaaS) used by `example` commands.
export const EXAMPLE_INPUTS = {
  businessType: 'saas',
  pricing: 49,
  billingCycle: 'monthly',
  monthlyChurn: 5,
  cac: 200,
  fixedCosts: 15000,
  variableCostPerUnit: 5,
  monthlyNewCustomers: 50,
  currentRevenue: 0,
  currentCustomers: 0,
  currentRunway: 12
}
