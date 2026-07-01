import {
  DEFAULT_BREAK_GUARD_CONFIG,
  sanitizeBreakGuardConfig,
} from './break-guard-config'

describe('break guard config', () => {
  it('uses 1 and 3 minutes as the default break presets', () => {
    expect(DEFAULT_BREAK_GUARD_CONFIG.presetMinutes).toEqual([1, 3])
  })

  it('normalizes invalid values to safe defaults', () => {
    expect(sanitizeBreakGuardConfig({
      enabled: 'yes',
      promptDelaySeconds: -1,
      presetMinutes: ['x', 0],
      allowCustomMinutes: 'no',
      targetPath: 'https://example.com',
      alertStrength: 'loud',
      snoozeMinutes: [],
      recordBreakLogs: 'yes',
    })).toEqual(DEFAULT_BREAK_GUARD_CONFIG)
  })

  it('deduplicates and sorts minute presets', () => {
    expect(sanitizeBreakGuardConfig({
      presetMinutes: [20, 5, 10, 5],
      snoozeMinutes: [5, 1, 3, 1],
    }).presetMinutes).toEqual([5, 10, 20])
  })
})
