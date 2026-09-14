import { describe, expect, it } from 'vitest'

import { decideRepairAction, normalizeErrorKey, extractFilePath, MAX_REPAIR_ATTEMPTS } from '@/lib/repair-loop'

describe('normalizeErrorKey', () => {
  it('collapses volatile numbers/whitespace so near-identical errors compare equal', () => {
    const a = normalizeErrorKey('TypeError: Cannot read properties of undefined at Hero.vue:12:5')
    const b = normalizeErrorKey('TypeError: Cannot read properties of undefined at   Hero.vue:99:1')
    expect(a).toBe(b)
  })

  it('still distinguishes genuinely different errors', () => {
    const a = normalizeErrorKey('ReferenceError: foo is not defined')
    const b = normalizeErrorKey('ReferenceError: bar is not defined')
    expect(a).not.toBe(b)
  })
})

describe('extractFilePath', () => {
  it('pulls a project-relative component path out of a stack trace', () => {
    expect(extractFilePath('at setup (src/components/Hero.vue:14:3)')).toBe('src/components/Hero.vue')
  })

  it('returns undefined when no path is present', () => {
    expect(extractFilePath('something went wrong')).toBeUndefined()
  })
})

describe('decideRepairAction', () => {
  it('repairs a first-time error', () => {
    const action = decideRepairAction({ attempts: 0, lastErrorKey: null }, 'err-a')
    expect(action).toEqual({ type: 'repair' })
  })

  it('repairs a genuinely different error even after a previous attempt', () => {
    const action = decideRepairAction({ attempts: 1, lastErrorKey: 'err-a' }, 'err-b')
    expect(action).toEqual({ type: 'repair' })
  })

  it('stops immediately if the exact same error comes back after a repair attempt', () => {
    const action = decideRepairAction({ attempts: 1, lastErrorKey: 'err-a' }, 'err-a')
    expect(action).toEqual({ type: 'stop_repeated_error' })
  })

  it('stops once the attempt budget is exhausted, even for a new error', () => {
    const action = decideRepairAction({ attempts: MAX_REPAIR_ATTEMPTS, lastErrorKey: 'err-a' }, 'err-b')
    expect(action).toEqual({ type: 'stop_max_attempts' })
  })

  it('does not retry indefinitely — MAX_REPAIR_ATTEMPTS bounds a run of distinct errors', () => {
    let state = { attempts: 0, lastErrorKey: null as string | null }
    let repairs = 0
    for (let i = 0; i < 10; i++) {
      const key = `err-${i}` // a different error every time — never triggers the repeated-error stop
      const action = decideRepairAction(state, key)
      if (action.type !== 'repair') break
      repairs++
      state = { attempts: state.attempts + 1, lastErrorKey: key }
    }
    expect(repairs).toBe(MAX_REPAIR_ATTEMPTS)
  })
})
