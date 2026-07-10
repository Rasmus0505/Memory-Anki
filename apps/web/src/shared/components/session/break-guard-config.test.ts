import {
  BREAK_GUARD_CONFIG_VERSION,
  DEFAULT_BREAK_GUARD_CONFIG,
  sanitizeBreakGuardConfig,
} from './break-guard-config'

describe('break guard config', () => {
  it('uses a manual, gentle 5-minute break by default', () => {
    expect(DEFAULT_BREAK_GUARD_CONFIG).toMatchObject({
      schemaVersion: BREAK_GUARD_CONFIG_VERSION,
      enabled: true,
      promptOnWindowLeave: false,
      promptDelaySeconds: 60,
      presetMinutes: [5],
      autoFinishOnStudyReturn: false,
      resumeInterruptedStudyOnReturn: false,
      alertStrength: 'gentle',
    })
  })

  it('normalizes invalid values to safe defaults', () => {
    expect(sanitizeBreakGuardConfig({
      enabled: 'yes',
      promptDelaySeconds: -1,
      presetMinutes: ['x', 0],
      allowCustomMinutes: 'no',
      autoFinishOnStudyReturn: 'yes',
      resumeInterruptedStudyOnReturn: 'yes',
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

  it('migrates untouched legacy defaults and preserves explicit custom values', () => {
    const migrated = sanitizeBreakGuardConfig({
      enabled: true,
      promptDelaySeconds: 5,
      presetMinutes: [1, 3],
      allowCustomMinutes: true,
      autoFinishOnStudyReturn: true,
      resumeInterruptedStudyOnReturn: false,
      targetPath: '/freestyle',
      alertStrength: 'strong',
      snoozeMinutes: [1, 3, 5],
      recordBreakLogs: true,
    })

    expect(migrated).toMatchObject({
      schemaVersion: BREAK_GUARD_CONFIG_VERSION,
      promptOnWindowLeave: false,
      promptDelaySeconds: 60,
      presetMinutes: [5],
      autoFinishOnStudyReturn: false,
      resumeInterruptedStudyOnReturn: false,
      alertStrength: 'gentle',
    })
  })

  it('does not migrate current-version values that resemble old defaults', () => {
    const config = sanitizeBreakGuardConfig({
      ...DEFAULT_BREAK_GUARD_CONFIG,
      schemaVersion: BREAK_GUARD_CONFIG_VERSION,
      promptOnWindowLeave: true,
      promptDelaySeconds: 5,
      presetMinutes: [1, 3],
      autoFinishOnStudyReturn: true,
      resumeInterruptedStudyOnReturn: true,
      alertStrength: 'strong',
    })

    expect(config.promptOnWindowLeave).toBe(true)
    expect(config.promptDelaySeconds).toBe(5)
    expect(config.presetMinutes).toEqual([1, 3])
    expect(config.alertStrength).toBe('strong')
  })
})
