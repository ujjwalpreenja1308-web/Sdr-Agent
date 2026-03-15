import type { OnboardingProfile } from './api'

export type OnboardingTextField =
  | 'product_name'
  | 'product_description'
  | 'target_customer'
  | 'value_proposition'
  | 'pain_points'
  | 'call_to_action'
  | 'voice_guidelines'

export type OnboardingListField =
  | 'industries'
  | 'titles'
  | 'company_sizes'
  | 'geos'
  | 'exclusions'

export function csvToList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function calculateOnboardingProgress(profile: OnboardingProfile) {
  const trackedFields = [
    profile.product_name,
    profile.product_description,
    profile.target_customer,
    profile.value_proposition,
    profile.pain_points,
    profile.call_to_action,
    profile.voice_guidelines,
    profile.industries.join(','),
    profile.titles.join(','),
    profile.company_sizes.join(','),
    profile.geos.join(','),
  ]
  const completed = trackedFields.filter((field) => field.trim()).length
  return Math.floor((completed / trackedFields.length) * 100)
}
